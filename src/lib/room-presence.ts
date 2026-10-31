export type RoomPresenceKey = 'participant-1' | 'participant-2'

export type RoomState = 'waiting' | 'active' | 'ended'

export type RoomActivity =
  | 'idle'
  | 'capturing'
  | 'reviewing'
  | 'editing'
  | 'sharing'

export interface RoomPresenceIdentity {
  key: RoomPresenceKey
  displayName: string
}

export interface RoomPresenceParticipant extends RoomPresenceIdentity {
  isCurrentUser: boolean
  isHost: boolean
  activity: RoomActivity
}

export function getParticipantDisplayName(key: RoomPresenceKey) {
  return key === 'participant-1' ? 'Participant 1' : 'Participant 2'
}

export function isRoomPresenceKey(value: string): value is RoomPresenceKey {
  return value === 'participant-1' || value === 'participant-2'
}

export function isRoomActivity(value: unknown): value is RoomActivity {
  return (
    value === 'idle' ||
    value === 'capturing' ||
    value === 'reviewing' ||
    value === 'editing' ||
    value === 'sharing'
  )
}
