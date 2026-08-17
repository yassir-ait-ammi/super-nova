import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { TestSupportController } from "./test-support.controller";

/** Imported by AppModule only when NODE_ENV === "test". See test-support.controller.ts. */
@Module({
  imports: [EmailModule],
  controllers: [TestSupportController],
})
export class TestSupportModule {}
