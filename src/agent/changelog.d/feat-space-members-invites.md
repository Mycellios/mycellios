### Added

- Behind the server setting `MYCELLIOS_SPACE_MEMBERS_ENABLED` (off by default), the owner or
  an admin of a space other than Personal can invite people by email or with a one-use link,
  valid for seven days. People who join see the space in the space menu with its owner's name,
  can see who is in it and can leave; the owner changes roles and anyone who manages the space
  can remove a member. Sharing Micos and talking to them in a shared space come in a later
  release. With the setting off, nothing changes.

### Self-host upgrade notes

- Apply the additive migration `20261125100000_space_members` before starting this version. It
  adds the `space_invitations` table with row-level security and makes a new organization
  membership join the organization's default space only for an owner, so a person invited to
  one space never reaches the owner's Personal space. Set `MYCELLIOS_SPACE_MEMBERS_ENABLED=true`
  to turn the feature on and `MYCELLIOS_SPACE_MEMBER_LIMIT` (2 to 100, default 20) to change
  how many people a space can hold. Email invitations use the email provider already configured
  for sign-in; without one, share the link instead.
