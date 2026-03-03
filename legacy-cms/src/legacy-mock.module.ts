import { Module } from '@nestjs/common';
import { LegacyMockController } from './legacy-mock.controller';

@Module({
  controllers: [LegacyMockController],
})
export class LegacyMockModule {}
