import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Gender: a.enum(['MALE', 'FEMALE', 'MIXED', 'UNSPECIFIED']),
  TournamentMode: a.enum(['KNOCKOUT', 'ROUND_ROBIN']),
  EventType: a.enum(['SINGLES', 'DOUBLES']),
  TournamentStatus: a.enum(['DRAFT', 'LIVE', 'COMPLETED']),
  ParticipantType: a.enum(['PLAYER', 'TEAM']),
  MatchStatus: a.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  MatchStage: a.enum(['GROUP', 'KNOCKOUT']),

  Player: a
    .model({
      name: a.string().required(),
      gender: a.ref('Gender').required(),
      isActive: a.boolean().required(),
      createdTeamsAsPlayerOne: a.hasMany('Team', 'playerOneId'),
      createdTeamsAsPlayerTwo: a.hasMany('Team', 'playerTwoId'),
      singlesEntries: a.hasMany('TournamentEntry', 'playerId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.groups(['admin']),
    ]),

  Team: a
    .model({
      name: a.string().required(),
      playerOneId: a.id().required(),
      playerTwoId: a.id().required(),
      playerOne: a.belongsTo('Player', 'playerOneId'),
      playerTwo: a.belongsTo('Player', 'playerTwoId'),
      tournamentEntries: a.hasMany('TournamentEntry', 'teamId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.groups(['admin']),
    ]),

  Tournament: a
    .model({
      name: a.string().required(),
      mode: a.ref('TournamentMode').required(),
      eventType: a.ref('EventType').required(),
      status: a.ref('TournamentStatus').required(),
      groupCount: a.integer(),
      qualifyPerGroup: a.integer(),
      bracketSize: a.integer(),
      roundLabels: a.string().array(),
      startedAt: a.string(),
      completedAt: a.string(),
      entries: a.hasMany('TournamentEntry', 'tournamentId'),
      matches: a.hasMany('Match', 'tournamentId'),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.groups(['admin']),
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
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.groups(['admin']),
    ]),

  Match: a
    .model({
      tournamentId: a.id().required(),
      tournament: a.belongsTo('Tournament', 'tournamentId'),
      stage: a.ref('MatchStage').required(),
      status: a.ref('MatchStatus').required(),
      roundNumber: a.integer().required(),
      roundLabel: a.string().required(),
      matchNumber: a.integer().required(),
      displayOrder: a.integer().required(),
      groupName: a.string(),
      participantAEntryId: a.id(),
      participantAEntry: a.belongsTo('TournamentEntry', 'participantAEntryId'),
      participantAName: a.string(),
      participantBEntryId: a.id(),
      participantBEntry: a.belongsTo('TournamentEntry', 'participantBEntryId'),
      participantBName: a.string(),
      winnerEntryId: a.id(),
      winnerEntry: a.belongsTo('TournamentEntry', 'winnerEntryId'),
      score: a.string(),
      completedAt: a.string(),
    })
    .authorization((allow) => [
      allow.publicApiKey().to(['read']),
      allow.groups(['admin']),
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
