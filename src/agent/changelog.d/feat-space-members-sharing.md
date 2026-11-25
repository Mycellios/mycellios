### Added

- Behind the server setting `MYCELLIOS_SPACE_MEMBERS_ENABLED` (off by default), the server side
  of sharing Micos in a space other than Personal: the owner or an admin shares a Mico with
  chosen people or with everyone in the space, and each person talks to it in their own
  conversations. The Mico's owner pays in Credits, up to a daily limit per person (1 Credit per
  day unless the owner sets another; 0 pauses their messages), and can read those
  conversations. The invitation page now says so. A person's turns never use the owner's
  memory, connected apps, secrets, computer, schedules or other Micos. The screens to share a
  Mico and to talk to one come in a later release; with the setting off, nothing changes.

### Self-host upgrade notes

- Apply the additive migration `20261125120000_space_member_sharing` before starting this
  version, and run the API and worker of this version together before turning
  `MYCELLIOS_SPACE_MEMBERS_ENABLED` on. It adds the `mico_shares` and `mico_share_members` tables
  with row-level security and nullable columns that name the person behind a conversation,
  message, turn, upload, receipt and Credit hold. People's turns run only on Mycellios Credits,
  so a Mico on the owner's own key or sign-in answers them with a refusal.
