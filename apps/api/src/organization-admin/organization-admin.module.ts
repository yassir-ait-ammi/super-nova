import { Module } from "@nestjs/common";
import { AccessControlModule } from "../access-control/access-control.module";
import { BusinessScopesController } from "./business-scopes.controller";
import { BusinessScopesService } from "./business-scopes.service";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";

@Module({
  imports: [AccessControlModule],
  controllers: [CompaniesController, BusinessScopesController],
  providers: [CompaniesService, BusinessScopesService],
})
export class OrganizationAdminModule {}
