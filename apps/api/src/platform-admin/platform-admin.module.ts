import { Module } from "@nestjs/common";
import { AccessControlModule } from "../access-control/access-control.module";
import { IdentityModule } from "../identity/identity.module";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [AccessControlModule, IdentityModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class PlatformAdminModule {}
