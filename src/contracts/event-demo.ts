/** Guest/presenter DTOs never include an account id, credential or browser proof. */
export interface EventDemoMetadata {
  id: string; title: string; open: boolean; full: boolean; startsAt: number; endsAt: number;
  maxGuests: number; joined: number; grantMicrounits: number; model: string; modelName: string;
  provider: string; processing: string; browserInference: boolean; inviteUrl: string;
}
export interface EventDemoSession {
  guest: { number: number; name: string }; open: boolean; endsAt: number;
  creditsMicrounits: number; reservedMicrounits: number; earnedMicrounits: number;
}
export interface EventDemoDevice {
  number: number; kind: string; present: boolean; connected: boolean; working: boolean;
  earnedMicrounits: number; inferences: number;
}
export interface EventDemoNetwork extends EventDemoMetadata {
  at: number; devices: EventDemoDevice[]; connected: number; inferences: number; earnedMicrounits: number;
}
