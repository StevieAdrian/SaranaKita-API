import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PushPayload = {
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string>;
};

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private messaging: Messaging | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const serviceAccountJson = this.configService.get<string>(
      'firebase.serviceAccount',
    );
    const configuredPath = this.configService.get<string>(
      'firebase.serviceAccountPath',
    );

    try {
      let serviceAccount: ServiceAccount;
      if (serviceAccountJson) {
        serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
      } else {
        const credentialPath = resolve(
          process.cwd(),
          configuredPath || '.secrets/firebase-service-account.json',
        );
        if (!existsSync(credentialPath)) {
          this.logger.warn(
            'FCM disabled: Firebase service-account credential is missing.',
          );
          return;
        }
        serviceAccount = JSON.parse(
          readFileSync(credentialPath, 'utf8'),
        ) as ServiceAccount;
      }
      const app =
        getApps().length > 0
          ? getApp()
          : initializeApp({ credential: cert(serviceAccount) });
      this.messaging = getMessaging(app);
      this.logger.log('Firebase Cloud Messaging is ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`FCM disabled: ${message}`);
    }
  }

  async sendToTokens(
    tokens: readonly string[],
    payload: PushPayload,
  ): Promise<string[]> {
    if (!this.messaging || tokens.length === 0) return [];

    const invalidTokens: string[] = [];
    for (let start = 0; start < tokens.length; start += 500) {
      const chunk = tokens.slice(start, start + 500);
      try {
        const response = await this.messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: { priority: 'high' },
        });
        response.responses.forEach((result, index) => {
          const code = result.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            const token = chunk[index];
            if (token) invalidTokens.push(token);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unable to send FCM push: ${message}`);
      }
    }
    return invalidTokens;
  }
}
