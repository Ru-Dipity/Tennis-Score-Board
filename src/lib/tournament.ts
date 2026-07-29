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

export function shuffleSelectedParticipants(items: string[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
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

export function buildKnockoutPlan(
  participants: ParticipantSeed[],
  customLabels: string[] = [],
  matchFormat: MatchFormat = 'BEST_OF_3',
  eventType: EventType = 'SINGLES',
) {
  const bracketSize = nextPowerOfTwo(participants.length);
  const roundLabels = createRoundLabels(bracketSize, customLabels);

  const entries: EntryPlan[] = Array.from({ length: bracketSize }, (_, index) => {
    const participant = participants[index];
    return {
      seed: index + 1,
      entryName: participant?.displayName ?? 'BYE',
      participantType: participant?.participantType ?? 'PLAYER',
      playerId: participant?.playerId,
      teamId: participant?.teamId,
      slotNumber: index + 1,
      isBye: !participant,
    };
  });

  const entryNames = seedNameMap(entries);
  const matches: MatchPlan[] = [];
  let displayOrder = 1;

  for (let matchIndex = 0; matchIndex < bracketSize / 2; matchIndex += 1) {
    const entryA = entries[matchIndex * 2];
    const entryB = entries[matchIndex * 2 + 1];
    const match: MatchPlan = {
      stage: 'KNOCKOUT',
      status: 'PENDING',
      roundNumber: 1,
      roundLabel: roundLabels[0] ?? 'Opening Round',
      matchNumber: matchIndex + 1,
      displayOrder,
      participantASeeds: entryA.isBye ? undefined : [entryA.seed],
      participantAName: entryA.isBye ? undefined : entryA.entryName,
      participantBSeeds: entryB.isBye ? undefined : [entryB.seed],
      participantBName: entryB.isBye ? undefined : entryB.entryName,
      matchFormat,
      matchCategory: getStandardCategory(eventType),
    };

    if (entryA.isBye !== entryB.isBye) {
      match.status = 'COMPLETED';
      match.score = 'BYE';
      match.winnerSeeds = entryA.isBye ? [entryB.seed] : [entryA.seed];
      match.winnerSide = entryA.isBye ? 'B' : 'A';
    }

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
  teamSize: number,
  teamLabels: string[],
  matchFormat: MatchFormat = 'BEST_OF_3',
) {
  if (teamCount !== 2) {
    throw new Error('Current team battle implementation supports exactly 2 teams.');
  }

  if (participants.length !== teamCount * teamSize) {
    throw new Error('Selected players must exactly match teamCount x teamSize.');
  }

  if (teamSize < 2 || teamSize % 2 !== 0) {
    throw new Error('Team battle currently requires an even team size of at least 2.');
  }

  const resolvedLabels =
    teamLabels.filter((label) => label.trim()).length === teamCount
      ? teamLabels.map((label) => label.trim())
      : Array.from({ length: teamCount }, (_, index) => `Team ${String.fromCharCode(65 + index)}`);

  const entries: EntryPlan[] = [];
  const teamBuckets: EntryPlan[][] = [];
  let seed = 1;

  for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
    const label = resolvedLabels[teamIndex];
    const members = participants.slice(teamIndex * teamSize, (teamIndex + 1) * teamSize);
    const teamEntries = members.map((participant, memberIndex) => ({
      seed: seed + memberIndex,
      entryName: participant.displayName,
      participantType: 'PLAYER' as const,
      playerId: participant.playerId,
      groupName: label,
      slotNumber: memberIndex + 1,
      isBye: false,
      teamOrder: memberIndex + 1,
    }));

    entries.push(...teamEntries);
    teamBuckets.push(teamEntries);
    seed += teamEntries.length;
  }

  const [teamA, teamB] = teamBuckets;
  const matches: MatchPlan[] = [];
  let displayOrder = 1;

  for (let index = 0; index < teamSize; index += 1) {
    matches.push({
      stage: 'TEAM_BATTLE',
      status: 'PENDING',
      roundNumber: 1,
      roundLabel: 'Team Singles',
      matchNumber: displayOrder,
      displayOrder,
      groupName: 'Singles',
      participantASeeds: [teamA[index].seed],
      participantAName: `${teamA[index].entryName} (#${teamA[index].teamOrder})`,
      participantBSeeds: [teamB[index].seed],
      participantBName: `${teamB[index].entryName} (#${teamB[index].teamOrder})`,
      matchFormat,
      matchCategory: 'TEAM_SINGLES',
      participantATeamLabel: resolvedLabels[0],
      participantBTeamLabel: resolvedLabels[1],
    });
    displayOrder += 1;
  }

  const pairCount = teamSize / 2;
  for (let index = 0; index < pairCount; index += 1) {
    const participantASeeds = [teamA[index].seed, teamA[index + pairCount].seed];
    const participantBSeeds = [teamB[index].seed, teamB[index + pairCount].seed];

    matches.push({
      stage: 'TEAM_BATTLE',
      status: 'PENDING',
      roundNumber: 2,
      roundLabel: 'Team Doubles',
      matchNumber: displayOrder,
      displayOrder,
      groupName: 'Doubles',
      participantASeeds,
      participantAName: `${teamA[index].entryName} / ${teamA[index + pairCount].entryName}`,
      participantBSeeds,
      participantBName: `${teamB[index].entryName} / ${teamB[index + pairCount].entryName}`,
      matchFormat,
      matchCategory: 'TEAM_DOUBLES',
      participantATeamLabel: resolvedLabels[0],
      participantBTeamLabel: resolvedLabels[1],
    });
    displayOrder += 1;
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

function extractScoreInfo(match: {
  participantAScores?: Array<number | null | undefined> | null;
  participantBScores?: Array<number | null | undefined> | null;
  score?: string | null;
}) {
  const participantAScores = (match.participantAScores ?? []).filter(
    (value): value is number => typeof value === 'number',
  );
  const participantBScores = (match.participantBScores ?? []).filter(
    (value): value is number => typeof value === 'number',
  );

  if (participantAScores.length && participantAScores.length === participantBScores.length) {
    return evaluateMatchScore(participantAScores, participantBScores, 'BEST_OF_5');
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
