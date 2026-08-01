import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Gender: a.enum(['MALE', 'FEMALE', 'MIXED', 'UNSPECIFIED']),
  TournamentMode: a.enum(['KNOCKOUT', 'ROUND_ROBIN', 'TEAM_BATTLE']),
  EventType: a.enum(['SINGLES', 'DOUBLES', 'TEAM']),
  TournamentStatus: a.enum(['DRAFT', 'LIVE', 'COMPLETED']),
  ParticipantType: a.enum(['PLAYER', 'TEAM']),
  MatchStatus: a.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  MatchStage: a.enum(['GROUP', 'KNOCKOUT', 'TEAM_BATTLE']),
  MatchFormat: a.enum(['SINGLE_SET', 'BEST_OF_3', 'BEST_OF_5']),
  MatchCategory: a.enum([
    'STANDARD_SINGLES',
    'STANDARD_DOUBLES',
    'TEAM_SINGLES',
    'TEAM_DOUBLES',
  ]),
  WinnerSide: a.enum(['A', 'B']),

  Player: a
    .model({
      name: a.string().required(),
      gender: a.ref('Gender').required(),
      isActive: a.boolean().required(),
      teamMemberships: a.hasMany('TeamMember', 'playerId'),
      singlesEntries: a.hasMany('TournamentEntry', 'playerId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  Team: a
    .model({
      name: a.string().required(),
      members: a.hasMany('TeamMember', 'teamId'),
      tournamentEntries: a.hasMany('TournamentEntry', 'teamId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  TeamMember: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      order: a.integer(),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  EventGroup: a
    .model({
      name: a.string().required(),
      eventDate: a.string().required(),
      isArchived: a.boolean().default(false),
      events: a.hasMany('Tournament', 'eventGroupId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  Tournament: a
    .model({
      name: a.string().required(),
      eventName: a.string(),
      eventGroupId: a.id(),
      eventGroup: a.belongsTo('EventGroup', 'eventGroupId'),
      mode: a.ref('TournamentMode').required(),
      eventType: a.ref('EventType').required(),
      status: a.ref('TournamentStatus').required(),
      groupCount: a.integer(),
      qualifyPerGroup: a.integer(),
      bracketSize: a.integer(),
      roundLabels: a.string().array(),
      matchFormat: a.ref('MatchFormat').required(),
      teamCount: a.integer(),
      teamSize: a.integer(),
      teamLabels: a.string().array(),
      eventDate: a.string().required(),
      isArchived: a.boolean().default(false),
      startedAt: a.string(),
      completedAt: a.string(),
      entries: a.hasMany('TournamentEntry', 'tournamentId'),
      matches: a.hasMany('Match', 'tournamentId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  TournamentEntry: a
    .model({
      tournamentId: a.id().required(),
      tournament: a.belongsTo('Tournament', 'tournamentId'),
      participantType: a.ref('ParticipantType').required(),
      playerId: a.id(),
      player: a.belongsTo('Player', 'playerId'),
      teamId: a.id(),
      team: a.belongsTo('Team', 'teamId'),
      entryName: a.string().required(),
      seed: a.integer(),
      groupName: a.string(),
      slotNumber: a.integer(),
      isBye: a.boolean().required(),
      teamOrder: a.integer(),
      matchesAsParticipantA: a.hasMany('Match', 'participantAEntryId'),
      matchesAsParticipantB: a.hasMany('Match', 'participantBEntryId'),
      matchesAsWinner: a.hasMany('Match', 'winnerEntryId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),

  Match: a
    .model({
      tournamentId: a.id().required(),
      tournament: a.belongsTo('Tournament', 'tournamentId'),
      stage: a.ref('MatchStage').required(),
      status: a.ref('MatchStatus').required(),
      matchFormat: a.ref('MatchFormat').required(),
      matchCategory: a.ref('MatchCategory').required(),
      roundNumber: a.integer().required(),
      roundLabel: a.string().required(),
      matchNumber: a.integer().required(),
      displayOrder: a.integer().required(),
      groupName: a.string(),
      
      participantAEntryId: a.id(),
      participantAEntry: a.belongsTo('TournamentEntry', 'participantAEntryId'),
      participantAEntryIds: a.string().array(),
      participantAName: a.string(),
      participantATeamLabel: a.string(),
      participantAScores: a.integer().array(),
      
      participantBEntryId: a.id(),
      participantBEntry: a.belongsTo('TournamentEntry', 'participantBEntryId'),
      participantBEntryIds: a.string().array(),
      participantBName: a.string(),
      participantBTeamLabel: a.string(),
      participantBScores: a.integer().array(),
      
      winnerEntryId: a.id(),
      winnerEntry: a.belongsTo('TournamentEntry', 'winnerEntryId'),
      winnerSide: a.ref('WinnerSide'),
      
      score: a.string(),
      completedAt: a.string(),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.owner(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});
