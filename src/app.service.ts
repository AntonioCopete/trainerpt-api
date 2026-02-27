import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    const response = { name: 'Ant' };
    return JSON.stringify(response);
  }
}
