import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { IdentityModule } from "../identity/identity.module";
import { CollaboratorInvitationsController } from "./collaborator-invitations.controller";
import { EffectiveAccessService } from "./effective-access.service";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";
import { MembersController } from "./members.controller";
import { MembershipService } from "./membership.service";
import { MyOrganizationController } from "./my-organization.controller";
import { OrgAdminGuard } from "./org-admin.guard";
import { OrgMemberGuard } from "./org-member.guard";
import { OrgOwnerGuard } from "./org-owner.guard";
import { OwnershipTransferController } from "./ownership-transfer.controller";
import { CapabilityGuard } from "./require-capability.decorator";

@Module({
  imports: [EmailModule, IdentityModule],
  controllers: [
    InvitationsController,
    CollaboratorInvitationsController,
    MembersController,
    OwnershipTransferController,
    MyOrganizationController,
  ],
  providers: [
    InvitationsService,
    MembershipService,
    EffectiveAccessService,
    OrgMemberGuard,
    OrgAdminGuard,
    OrgOwnerGuard,
    CapabilityGuard,
  ],
  exports: [
    IdentityModule,
    InvitationsService,
    MembershipService,
    EffectiveAccessService,
    OrgMemberGuard,
    OrgAdminGuard,
    OrgOwnerGuard,
    CapabilityGuard,
  ],
})
export class AccessControlModule {}
