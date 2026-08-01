export type TournamentMode = 'KNOCKOUT' | 'ROUND_ROBIN' | 'TEAM_BATTLE';
export type EventType = 'SINGLES' | 'DOUBLES' | 'TEAM';
export type ParticipantType = 'PLAYER' | 'TEAM';
export type MatchStage = 'GROUP' | 'KNOCKOUT' | 'TEAM_BATTLE';
export type MatchStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type MatchFormat = 'SINGLE_SET' | 'BEST_OF_3' | 'BEST_OF_5';
export type MatchCategory =
  | 'STANDARD_SINGLES'
  | 'STANDARD_DOUBLES'
  | 'TEAM_SINGLES'
  | 'TEAM_DOUBLES';
export type WinnerSide = 'A' | 'B';

export type ParticipantSeed = {
  sourceId: string;
  displayName: string;
  participantType: ParticipantType;
  playerId?: string;
  teamId?: string;
  selectionOrder?: number;
};

export type EntryPlan = {
  seed: number;
  entryName: string;
  participantType: ParticipantType;
  playerId?: string;
  teamId?: string;
  groupName?: string;
  slotNumber: number;
  isBye: boolean;
  teamOrder?: number;
};

export type MatchPlan = {
  stage: MatchStage;
  status: MatchStatus;
  roundNumber: number;
  roundLabel: string;
  matchNumber: number;
  displayOrder: number;
  groupName?: string;
  participantASeeds?: number[];
  participantAName?: string;
  participantBSeeds?: number[];
  participantBName?: string;
  winnerSeeds?: number[];
  winnerSide?: WinnerSide;
  score?: string;
  participantAScores?: number[];
  participantBScores?: number[];
  matchFormat: MatchFormat;
  matchCategory: MatchCategory;
  participantATeamLabel?: string;
  participantBTeamLabel?: string;
  teamDuelLabel?: string;
};

export type ParsedScore = {
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  winner: WinnerSide;
};

export type EvaluatedMatchScore = ParsedScore & {
  participantAScores: number[];
  participantBScores: number[];
  summary: string;
};

type StandingAccumulator = {
  entryId: string;
  entryName: string;
  groupName: string;
  wins: number;
  losses: number;
  points: number;
  gamesWon: number;
  gamesLost: number;
};

type TeamBattleAccumulator = {
  teamLabel: string;
  matchWins: number;
  gamesWon: number;
  gamesLost: number;
};

export function nextPowerOfTwo(value: number) {
  if (value <= 1) {
    return 1;
  }

  let size = 1;
  while (size < value) {
    size *= 2;
  }

  return size;
}

export function getBestOf(matchFormat: MatchFormat) {
  if (matchFormat === 'BEST_OF_5') {
    return 5;
  }
  if (matchFormat === 'BEST_OF_3') {
    return 3;
  }
  return 1;
}

export function getRequiredSetWins(matchFormat: MatchFormat) {
  return Math.ceil(getBestOf(matchFormat) / 2);
}

export function createEmptyScoreInputs(matchFormat: MatchFormat) {
  return Array.from({ length: getBestOf(matchFormat) }, () => '');
}

/**
 * Resolve the knockout match that a completed match's winner advances to.
 * The bracket maps match N in round R to match ceil(N/2) in round R+1.
 */
export function getKnockoutSuccessor(current: {
  roundNumber: number;
  matchNumber: number;
}) {
  return {
    roundNumber: current.roundNumber + 1,
    matchNumber: Math.ceil(current.matchNumber / 2),
  };
}

/** A score line is confirmable only when it evaluates to a valid winner. */
export function isMatchScoreValid(
  participantAInputs: Array<string | number | null | undefined>,
  participantBInputs: Array<string | number | null | undefined>,
  matchFormat: MatchFormat,
) {
  return evaluateMatchScore(participantAInputs, participantBInputs, matchFormat) !== null;
}

/** Human-readable status label for a match. */
export function getMatchStatusLabel(status: MatchStatus) {
  switch (status) {
    case 'COMPLETED':
      return 'Completed';
    case 'IN_PROGRESS':
      return 'In Progress';
    default:
      return 'Pending';
  }
}

export function createRoundLabels(bracketSize: number, customLabels: string[] = []) {
  const rounds = Math.log2(bracketSize);
  const labels: string[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const remaining = bracketSize / 2 ** round;

    if (customLabels[round]?.trim()) {
      labels.push(customLabels[round].trim());
      continue;
    }

    if (remaining === 2) {
      labels.push('Final');
    } else if (remaining === 4) {
      labels.push('Semifinal');
    } else if (remaining === 8) {
      labels.push('Quarterfinal');
    } else if (remaining === 16) {
      labels.push('Round of 16');
    } else if (remaining === 32) {
      labels.push('Round of 32');
    } else {
      labels.push(`Round of ${remaining}`);
    }
  }

  return labels;
}

function getStandardCategory(eventType: EventType): MatchCategory {
  return eventType === 'DOUBLES' ? 'STANDARD_DOUBLES' : 'STANDARD_SINGLES';
}

function seedNameMap(entries: EntryPlan[]) {
  return new Map(entries.map((entry) => [entry.seed, entry.entryName]));
}

function formatSeedNames(seeds: number[] | undefined, entryNames: Map<number, string>) {
  if (!seeds?.length) {
    return undefined;
  }

  return seeds.map((seed) => entryNames.get(seed) ?? `Seed ${seed}`).join(' / ');
}

function defaultTeamLabel(index: number) {
  return index < 26 ? `Team ${String.fromCharCode(65 + index)}` : `Team ${index + 1}`;
}

export function buildKnockoutPlan(
  firstRoundMatches: number,
  customLabels: string[] = [],
  matchFormat: MatchFormat = 'BEST_OF_3',
  eventType: EventType = 'SINGLES',
) {
  // The admin defines the first-round match count; that defines the number of
  // participants who play in round 1. The bracket is padded up to the next
  // power of two, and empty slots become BYEs placed from the bracket edges
  // inward so both halves of the draw receive them evenly (standard draw rules).
  const firstRoundParticipantCount = Math.max(1, Math.floor(firstRoundMatches || 1)) * 2;
  const bracketSize = Math.max(nextPowerOfTwo(firstRoundParticipantCount), 2);
  const roundLabels = createRoundLabels(bracketSize, customLabels);

  const byeCount = bracketSize - firstRoundParticipantCount;
  const byeSlots = new Set<number>();
  for (let index = 0; index < byeCount; index += 1) {
    const offset = Math.floor(index / 2);
    byeSlots.add(index % 2 === 0 ? offset + 1 : bracketSize - offset);
  }

  const entries: EntryPlan[] = Array.from({ length: bracketSize }, (_, index) => ({
    seed: index + 1,
    entryName: byeSlots.has(index + 1) ? 'BYE' : 'TBD',
    participantType: 'PLAYER' as const,
    slotNumber: index + 1,
    isBye: byeSlots.has(index + 1),
  }));

  const entryNames = seedNameMap(entries);
  const matches: MatchPlan[] = [];
  let displayOrder = 1;

  for (let matchIndex = 0; matchIndex < bracketSize / 2; matchIndex += 1) {
    const entryA = entries[matchIndex * 2];
    const entryB = entries[matchIndex * 2 + 1];
    const isByeMatch = entryA.isBye || entryB.isBye;
    const match: MatchPlan = {
      stage: 'KNOCKOUT',
      status: 'PENDING',
      roundNumber: 1,
      roundLabel: roundLabels[0] ?? 'Opening Round',
      matchNumber: matchIndex + 1,
      displayOrder,
      participantASeeds: entryA.isBye ? undefined : [entryA.seed],
      participantAName: entryA.isBye ? 'BYE' : undefined,
      participantBSeeds: entryB.isBye ? undefined : [entryB.seed],
      participantBName: entryB.isBye ? 'BYE' : undefined,
      score: isByeMatch ? 'BYE' : undefined,
      matchFormat,
      matchCategory: getStandardCategory(eventType),
    };

    matches.push(match);
    displayOrder += 1;
  }

  let previousRoundMatches = matches.filter((match) => match.roundNumber === 1);
  for (let roundNumber = 2; roundNumber <= roundLabels.length; roundNumber += 1) {
    const currentRoundMatches: MatchPlan[] = [];

    for (let matchIndex = 0; matchIndex < previousRoundMatches.length / 2; matchIndex += 1) {
      const feederA = previousRoundMatches[matchIndex * 2];
      const feederB = previousRoundMatches[matchIndex * 2 + 1];

      currentRoundMatches.push({
        stage: 'KNOCKOUT',
        status: 'PENDING',
        roundNumber,
        roundLabel: roundLabels[roundNumber - 1] ?? `Round ${roundNumber}`,
        matchNumber: matchIndex + 1,
        displayOrder,
        participantASeeds: feederA.winnerSeeds,
        participantAName: formatSeedNames(feederA.winnerSeeds, entryNames),
        participantBSeeds: feederB.winnerSeeds,
        participantBName: formatSeedNames(feederB.winnerSeeds, entryNames),
        matchFormat,
        matchCategory: getStandardCategory(eventType),
      });

      displayOrder += 1;
    }

    matches.push(...currentRoundMatches);
    previousRoundMatches = currentRoundMatches;
  }

  return {
    bracketSize,
    roundLabels,
    entries,
    matches,
  };
}

export function buildRoundRobinPlan(
  participants: ParticipantSeed[],
  groupCount: number,
  matchFormat: MatchFormat = 'BEST_OF_3',
  eventType: EventType = 'SINGLES',
) {
  const safeGroupCount = Math.max(1, Math.min(groupCount, participants.length));
  const groupNames = Array.from({ length: safeGroupCount }, (_, index) =>
    String.fromCharCode(65 + index),
  );

  const groups = new Map<string, ParticipantSeed[]>();
  groupNames.forEach((groupName) => groups.set(groupName, []));

  participants.forEach((participant, index) => {
    const groupName = groupNames[index % safeGroupCount];
    groups.get(groupName)?.push(participant);
  });

  let seed = 1;
  const entries: EntryPlan[] = [];
  const matches: MatchPlan[] = [];

  for (const groupName of groupNames) {
    const members = groups.get(groupName) ?? [];
    members.forEach((participant, index) => {
      entries.push({
        seed,
        entryName: participant.displayName,
        participantType: participant.participantType,
        playerId: participant.playerId,
        teamId: participant.teamId,
        groupName,
        slotNumber: index + 1,
        isBye: false,
      });
      seed += 1;
    });
  }

  let matchNumber = 1;
  for (const groupName of groupNames) {
    const groupEntries = entries.filter((entry) => entry.groupName === groupName);
    for (let indexA = 0; indexA < groupEntries.length; indexA += 1) {
      for (let indexB = indexA + 1; indexB < groupEntries.length; indexB += 1) {
        const entryA = groupEntries[indexA];
        const entryB = groupEntries[indexB];

        matches.push({
          stage: 'GROUP',
          status: 'PENDING',
          roundNumber: 1,
          roundLabel: `Group ${groupName}`,
          matchNumber,
          displayOrder: matchNumber,
          groupName,
          participantASeeds: [entryA.seed],
          participantAName: entryA.entryName,
          participantBSeeds: [entryB.seed],
          participantBName: entryB.entryName,
          matchFormat,
          matchCategory: getStandardCategory(eventType),
        });

        matchNumber += 1;
      }
    }
  }

  return {
    groupNames,
    entries,
    matches,
  };
}

export function buildTeamBattlePlan(
  participants: ParticipantSeed[],
  teamCount: number,
  singlesPerDuel: number,
  doublesPerDuel: number,
  matchFormat: MatchFormat = 'BEST_OF_3',
) {
  if (teamCount < 2) {
    throw new Error('Team battle requires at least 2 teams.');
  }

  if (singlesPerDuel < 1) {
    throw new Error('Team battle requires at least 1 singles match per duel.');
  }

  if (doublesPerDuel < 1) {
    throw new Error('Team battle requires at least 1 doubles match per duel.');
  }

  const resolvedLabels = Array.from({ length: teamCount }, (_, index) => defaultTeamLabel(index));

  // Roster slots per team: large enough to seed every singles slot and every
  // doubles pairing (index i pairs with index i + doublesPerDuel). Lineups are
  // later replaced with actual team members when an admin binds a system team.
  const rosterSize = Math.max(singlesPerDuel, doublesPerDuel * 2);

  const entries: EntryPlan[] = [];
  const teamBuckets: EntryPlan[][] = [];
  let seed = 1;

  for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
    const label = resolvedLabels[teamIndex];
    const members = participants.slice(teamIndex * rosterSize, (teamIndex + 1) * rosterSize);
    // Always create rosterSize slots per team; empty slots become TBD placeholders.
    const teamEntries: EntryPlan[] = Array.from({ length: rosterSize }, (_, memberIndex) => {
      const participant = members[memberIndex];
      return {
        seed: seed + memberIndex,
        entryName: participant?.displayName ?? 'TBD',
        participantType: 'PLAYER' as const,
        playerId: participant?.playerId,
        groupName: label,
        slotNumber: memberIndex + 1,
        isBye: false,
        teamOrder: memberIndex + 1,
      };
    });

    entries.push(...teamEntries);
    teamBuckets.push(teamEntries);
    seed += teamEntries.length;
  }

  const matches: MatchPlan[] = [];
  let displayOrder = 1;
  let duelNumber = 1;

  for (let teamAIndex = 0; teamAIndex < teamBuckets.length; teamAIndex += 1) {
    for (let teamBIndex = teamAIndex + 1; teamBIndex < teamBuckets.length; teamBIndex += 1) {
      const teamA = teamBuckets[teamAIndex];
      const teamB = teamBuckets[teamBIndex];
      const duelLabel = `${resolvedLabels[teamAIndex]} vs ${resolvedLabels[teamBIndex]}`;

      for (let index = 0; index < singlesPerDuel; index += 1) {
        matches.push({
          stage: 'TEAM_BATTLE',
          status: 'PENDING',
          roundNumber: duelNumber,
          roundLabel: duelLabel,
          matchNumber: displayOrder,
          displayOrder,
          groupName: 'Singles',
          participantASeeds: [teamA[index].seed],
          participantAName: `${teamA[index].entryName} (#${teamA[index].teamOrder})`,
          participantBSeeds: [teamB[index].seed],
          participantBName: `${teamB[index].entryName} (#${teamB[index].teamOrder})`,
          matchFormat,
          matchCategory: 'TEAM_SINGLES',
          participantATeamLabel: resolvedLabels[teamAIndex],
          participantBTeamLabel: resolvedLabels[teamBIndex],
          teamDuelLabel: duelLabel,
        });
        displayOrder += 1;
      }

      for (let index = 0; index < doublesPerDuel; index += 1) {
        const participantASeeds = [
          teamA[index].seed,
          teamA[index + doublesPerDuel].seed,
        ];
        const participantBSeeds = [
          teamB[index].seed,
          teamB[index + doublesPerDuel].seed,
        ];

        matches.push({
          stage: 'TEAM_BATTLE',
          status: 'PENDING',
          roundNumber: duelNumber,
          roundLabel: duelLabel,
          matchNumber: displayOrder,
          displayOrder,
          groupName: 'Doubles',
          participantASeeds,
          participantAName: `${teamA[index].entryName} / ${teamA[index + doublesPerDuel].entryName}`,
          participantBSeeds,
          participantBName: `${teamB[index].entryName} / ${teamB[index + doublesPerDuel].entryName}`,
          matchFormat,
          matchCategory: 'TEAM_DOUBLES',
          participantATeamLabel: resolvedLabels[teamAIndex],
          participantBTeamLabel: resolvedLabels[teamBIndex],
          teamDuelLabel: duelLabel,
        });
        displayOrder += 1;
      }

      duelNumber += 1;
    }
  }

  return {
    teamLabels: resolvedLabels,
    entries,
    matches,
  };
}

function normalizeSetValue(value: string | number | null | undefined) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function buildScoreSummary(
  participantAScores: Array<number | null | undefined>,
  participantBScores: Array<number | null | undefined>,
) {
  return participantAScores
    .map((scoreA, index) => {
      const scoreB = participantBScores[index];
      if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) {
        return null;
      }
      return `${scoreA}-${scoreB}`;
    })
    .filter(Boolean)
    .join(', ');
}

export function evaluateMatchScore(
  participantAInputs: Array<string | number | null | undefined>,
  participantBInputs: Array<string | number | null | undefined>,
  matchFormat: MatchFormat,
): EvaluatedMatchScore | null {
  const bestOf = getBestOf(matchFormat);
  const requiredSetWins = getRequiredSetWins(matchFormat);

  const participantAScores: number[] = [];
  const participantBScores: number[] = [];
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;

  for (let index = 0; index < bestOf; index += 1) {
    const scoreA = normalizeSetValue(participantAInputs[index]);
    const scoreB = normalizeSetValue(participantBInputs[index]);

    if (scoreA === null && scoreB === null) {
      continue;
    }

    if (scoreA === null || scoreB === null || scoreA === scoreB) {
      return null;
    }

    if (setsA >= requiredSetWins || setsB >= requiredSetWins) {
      return null;
    }

    participantAScores.push(scoreA);
    participantBScores.push(scoreB);
    gamesA += scoreA;
    gamesB += scoreB;

    if (scoreA > scoreB) {
      setsA += 1;
    } else {
      setsB += 1;
    }
  }

  if (setsA < requiredSetWins && setsB < requiredSetWins) {
    return null;
  }

  return {
    participantAScores,
    participantBScores,
    setsA,
    setsB,
    gamesA,
    gamesB,
    winner: setsA > setsB ? 'A' : 'B',
    summary: buildScoreSummary(participantAScores, participantBScores),
  };
}

export function parseScore(scoreText: string): ParsedScore | null {
  const sets = scoreText
    .split(',')
    .map((set) => set.trim())
    .filter(Boolean);

  if (sets.length === 0) {
    return null;
  }

  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;

  for (const set of sets) {
    const match = set.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
      return null;
    }

    const valueA = Number(match[1]);
    const valueB = Number(match[2]);

    gamesA += valueA;
    gamesB += valueB;

    if (valueA === valueB) {
      return null;
    }

    if (valueA > valueB) {
      setsA += 1;
    } else {
      setsB += 1;
    }
  }

  if (setsA === setsB) {
    return null;
  }

  return {
    setsA,
    setsB,
    gamesA,
    gamesB,
    winner: setsA > setsB ? 'A' : 'B',
  };
}

function inferMatchFormatFromScores(scoreCount: number): MatchFormat {
  if (scoreCount <= 1) {
    return 'SINGLE_SET';
  }

  if (scoreCount <= 3) {
    return 'BEST_OF_3';
  }

  return 'BEST_OF_5';
}

function extractScoreInfo(match: {
  participantAScores?: Array<number | null | undefined> | null;
  participantBScores?: Array<number | null | undefined> | null;
  score?: string | null;
  matchFormat?: MatchFormat | null;
}) {
  const participantAScores = (match.participantAScores ?? []).filter(
    (value): value is number => typeof value === 'number',
  );
  const participantBScores = (match.participantBScores ?? []).filter(
    (value): value is number => typeof value === 'number',
  );

  if (participantAScores.length && participantAScores.length === participantBScores.length) {
    return evaluateMatchScore(
      participantAScores,
      participantBScores,
      match.matchFormat ?? inferMatchFormatFromScores(participantAScores.length),
    );
  }

  if (match.score) {
    const parsed = parseScore(match.score);
    if (!parsed) {
      return null;
    }
    return {
      ...parsed,
      participantAScores: [],
      participantBScores: [],
      summary: match.score,
    };
  }

  return null;
}

export function calculateGroupStandings<
  TEntry extends { id: string; entryName?: string | null; groupName?: string | null },
  TMatch extends {
    groupName?: string | null;
    status?: string | null;
    participantAEntryId?: string | null;
    participantBEntryId?: string | null;
    participantAScores?: Array<number | null | undefined> | null;
    participantBScores?: Array<number | null | undefined> | null;
    score?: string | null;
    winnerEntryId?: string | null;
  },
>(entries: TEntry[], matches: TMatch[]) {
  const groups = new Map<string, StandingAccumulator[]>();

  for (const entry of entries) {
    if (!entry.groupName || !entry.entryName) {
      continue;
    }

    const bucket = groups.get(entry.groupName) ?? [];
    bucket.push({
      entryId: entry.id,
      entryName: entry.entryName,
      groupName: entry.groupName,
      wins: 0,
      losses: 0,
      points: 0,
      gamesWon: 0,
      gamesLost: 0,
    });
    groups.set(entry.groupName, bucket);
  }

  for (const match of matches) {
    if (
      !match.groupName ||
      match.status !== 'COMPLETED' ||
      !match.participantAEntryId ||
      !match.participantBEntryId ||
      !match.winnerEntryId
    ) {
      continue;
    }

    const standings = groups.get(match.groupName);
    if (!standings) {
      continue;
    }

    const entryA = standings.find((item) => item.entryId === match.participantAEntryId);
    const entryB = standings.find((item) => item.entryId === match.participantBEntryId);
    const parsedScore = extractScoreInfo(match);

    if (!entryA || !entryB || !parsedScore) {
      continue;
    }

    entryA.gamesWon += parsedScore.gamesA;
    entryA.gamesLost += parsedScore.gamesB;
    entryB.gamesWon += parsedScore.gamesB;
    entryB.gamesLost += parsedScore.gamesA;

    if (match.winnerEntryId === entryA.entryId) {
      entryA.wins += 1;
      entryA.points += 1;
      entryB.losses += 1;
    } else {
      entryB.wins += 1;
      entryB.points += 1;
      entryA.losses += 1;
    }
  }

  return Array.from(groups.entries()).map(([groupName, standings]) => ({
    groupName,
    standings: standings.sort((left, right) => {
      const pointDiff = right.points - left.points;
      if (pointDiff !== 0) {
        return pointDiff;
      }

      const rightNet = right.gamesWon - right.gamesLost;
      const leftNet = left.gamesWon - left.gamesLost;
      if (rightNet !== leftNet) {
        return rightNet - leftNet;
      }

      const totalGamesDiff = right.gamesWon - left.gamesWon;
      if (totalGamesDiff !== 0) {
        return totalGamesDiff;
      }

      return left.entryName.localeCompare(right.entryName, 'en');
    }),
  }));
}

export function calculateTeamBattleSummary<
  TMatch extends {
    matchCategory?: string | null;
    participantATeamLabel?: string | null;
    participantBTeamLabel?: string | null;
    status?: string | null;
    winnerSide?: WinnerSide | null;
    participantAScores?: Array<number | null | undefined> | null;
    participantBScores?: Array<number | null | undefined> | null;
    score?: string | null;
  },
>(matches: TMatch[]) {
  const summary = new Map<string, TeamBattleAccumulator>();

  for (const match of matches) {
    const teamA = match.participantATeamLabel || 'Team A';
    const teamB = match.participantBTeamLabel || 'Team B';

    if (!summary.has(teamA)) {
      summary.set(teamA, { teamLabel: teamA, matchWins: 0, gamesWon: 0, gamesLost: 0 });
    }
    if (!summary.has(teamB)) {
      summary.set(teamB, { teamLabel: teamB, matchWins: 0, gamesWon: 0, gamesLost: 0 });
    }

    const teamSummaryA = summary.get(teamA)!;
    const teamSummaryB = summary.get(teamB)!;
    const parsedScore = extractScoreInfo(match);

    if (parsedScore) {
      teamSummaryA.gamesWon += parsedScore.gamesA;
      teamSummaryA.gamesLost += parsedScore.gamesB;
      teamSummaryB.gamesWon += parsedScore.gamesB;
      teamSummaryB.gamesLost += parsedScore.gamesA;
    }

    if (match.status === 'COMPLETED' && match.winnerSide) {
      if (match.winnerSide === 'A') {
        teamSummaryA.matchWins += 1;
      } else {
        teamSummaryB.matchWins += 1;
      }
    }
  }

  const teams = Array.from(summary.values()).sort((left, right) =>
    left.teamLabel.localeCompare(right.teamLabel, 'en'),
  );

  const winner = [...teams].sort((left, right) => {
    const matchWinDiff = right.matchWins - left.matchWins;
    if (matchWinDiff !== 0) {
      return matchWinDiff;
    }

    const gameDiff =
      right.gamesWon - right.gamesLost - (left.gamesWon - left.gamesLost);
    if (gameDiff !== 0) {
      return gameDiff;
    }

    return right.gamesWon - left.gamesWon;
  })[0];

  return {
    teams,
    winner,
  };
}

export function formatRoundRobinMatrix<
  TEntry extends { id: string; entryName?: string | null; groupName?: string | null },
  TMatch extends {
    groupName?: string | null;
    participantAEntryId?: string | null;
    participantBEntryId?: string | null;
    participantAScores?: Array<number | null | undefined> | null;
    participantBScores?: Array<number | null | undefined> | null;
    score?: string | null;
  },
>(entries: TEntry[], matches: TMatch[], groupName: string) {
  const groupEntries = entries.filter(
    (entry) => entry.groupName === groupName && entry.entryName,
  );

  return groupEntries.map((rowEntry) => ({
    entry: rowEntry,
    cells: groupEntries.map((columnEntry) => {
      if (rowEntry.id === columnEntry.id) {
        return '—';
      }

      const match = matches.find(
        (item) =>
          item.groupName === groupName &&
          ((item.participantAEntryId === rowEntry.id &&
            item.participantBEntryId === columnEntry.id) ||
            (item.participantAEntryId === columnEntry.id &&
              item.participantBEntryId === rowEntry.id)),
      );

      if (!match) {
        return 'Pending';
      }

      const scoreSummary =
        buildScoreSummary(match.participantAScores ?? [], match.participantBScores ?? []) ||
        match.score ||
        '';

      if (!scoreSummary) {
        return 'Score pending';
      }

      if (match.participantAEntryId === rowEntry.id) {
        return scoreSummary;
      }

      return reverseScore(scoreSummary);
    }),
  }));
}

export function reverseScore(scoreText: string) {
  return scoreText
    .split(',')
    .map((set) => set.trim())
    .filter(Boolean)
    .map((set) => {
      const match = set.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!match) {
        return set;
      }

      return `${match[2]}-${match[1]}`;
    })
    .join(', ');
}
