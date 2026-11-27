import { GroupAvatar, type GroupAvatarMember } from "@mycellios/ui-web";

/**
 * A working Mico, as the reference app shows one: a light passes along the activity text and
 * three dots rise over the avatar. Flat colours only; both rest when motion is reduced.
 */
export function ActivityShine({ text }: { text: string }) {
  // The light is drawn from data-text by CSS, so the text is read (and tested) once.
  return <span className="rk-activity-label" data-text={text}>{text}</span>;
}

export function ThinkingAvatar({ members, size, active = true }: {
  members: GroupAvatarMember[];
  size: number;
  active?: boolean;
}) {
  const color = members[0]?.color;
  return <span className="rk-thinking-avatar" style={color ? { color } : undefined}>
    <GroupAvatar members={members} size={size} />
    {active ? <span aria-hidden="true" className="rk-thinking-dots"><i /><i /><i /></span> : null}
  </span>;
}
