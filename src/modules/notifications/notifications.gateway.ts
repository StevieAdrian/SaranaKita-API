import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AppNotification } from './notifications.types';

@WebSocketGateway({
  namespace: 'notifications',
  cors: { origin: true },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .auth.getUser(token);

      if (error || !data.user) {
        client.disconnect(true);
        return;
      }

      client.join(this.roomFor(data.user.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rejected notification socket: ${message}`);
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, notification: AppNotification): void {
    if (!this.server) {
      this.logger.warn('Notification gateway is not ready yet.');
      return;
    }
    this.server.to(this.roomFor(userId)).emit('notification:new', notification);
  }

  private roomFor(userId: string): string {
    return `user:${userId}`;
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authorization = client.handshake.headers.authorization;
    if (typeof authorization !== 'string') {
      return null;
    }
    const [type, token] = authorization.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
