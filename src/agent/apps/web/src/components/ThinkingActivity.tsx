import { GroupAvatar, type GroupAvatarMember } from "@mycellios/ui-web";

/**
 * A working Mico: a light passes along the activity text beside its avatar. The text alone
 * says it is working, so the avatar carries no extra marks. Flat colours only; the light
 * rests when motion is reduced.
 */
export function ActivityShine({ text }: { text: string }) {
  // The light is drawn from data-text by CSS, so the text is read (and tested) once.
  return <span className="rk-activity-label" data-text={text}>{text}</span>;
}

export function ThinkingAvatar({ members, size }: {
  members: GroupAvatarMember[];
  size: number;
  /** Kept for callers; the avatar looks the same whether or not the Mico is working. */
  active?: boolean;
}) {
  const color = members[0]?.color;
  return <span className="rk-thinking-avatar" style={color ? { color } : undefined}>
    <GroupAvatar members={members} size={size} />
  </span>;
}
