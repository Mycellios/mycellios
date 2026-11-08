import { z } from "zod";
import { SPORE_WELCOME_REWARD, TOKENS_PER_TRIAL_SPORE } from "../../../../contracts/spore-rewards.js";

export { SPORE_WELCOME_REWARD, TOKENS_PER_TRIAL_SPORE };

export const SporeRewardsSchema = z.object({
  welcome: z.literal(SPORE_WELCOME_REWARD),
  earned: z.number().int().nonnegative(),
  progressTokens: z.number().int().nonnegative().lt(TOKENS_PER_TRIAL_SPORE),
});
export type SporeRewards = z.infer<typeof SporeRewardsSchema>;
