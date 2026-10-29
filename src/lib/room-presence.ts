export type RoomPresenceKey = 'participant-1' | 'participant-2'

export interface RoomPresenceIdentity {
  key: RoomPresenceKey
  displayName: string
}

export interface RoomPresenceParticipant extends RoomPresenceIdentity {
  isCurrentUser: boolean
}

export function getParticipantDisplayName(key: RoomPresenceKey) {
  return key === 'participant-1' ? 'Participant 1' : 'Participant 2'
}

export function isRoomPresenceKey(value: string): value is RoomPresenceKey {
  return value === 'participant-1' || value === 'participant-2'
}
