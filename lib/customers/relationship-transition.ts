import { LineRelationshipStatus } from "@prisma/client";

type ComputeLineRefollowedAtInput = {
  previousStatus: LineRelationshipStatus | null;
  nextStatus: LineRelationshipStatus;
  previousLineRefollowedAt?: Date | null;
  now: Date;
  isCreate: boolean;
};

export function computeLineRefollowedAt(input: ComputeLineRefollowedAtInput): Date | null | undefined {
  if (input.isCreate) {
    return null;
  }

  if (input.nextStatus === LineRelationshipStatus.UNFOLLOWED) {
    return null;
  }

  if (
    input.previousStatus === LineRelationshipStatus.UNFOLLOWED &&
    input.nextStatus === LineRelationshipStatus.ACTIVE
  ) {
    return input.now;
  }

  return undefined;
}
