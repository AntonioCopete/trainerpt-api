import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // Simple health check endpoint for Cloud Run / load balancers
  @Get('health')
  health() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
