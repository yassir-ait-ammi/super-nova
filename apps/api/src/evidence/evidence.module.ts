import { Global, Module } from "@nestjs/common";
import { EvidenceService } from "./evidence.service";

@Global()
@Module({
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
