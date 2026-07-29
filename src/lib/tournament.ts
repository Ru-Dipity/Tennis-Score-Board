export type TournamentMode = 'KNOCKOUT' | 'ROUND_ROBIN';
export type EventType = 'SINGLES' | 'DOUBLES';
export type ParticipantType = 'PLAYER' | 'TEAM';
export type MatchStage = 'GROUP' | 'KNOCKOUT';
export type MatchStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export type ParticipantSeed = {
  sourceId: string;
  displayName: string;
  participantType: ParticipantType;
  playerId?: string;
  teamId?: string;
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
};

export type MatchPlan = {
  stage: MatchStage;
  status: MatchStatus;
  roundNumber: number;
  roundLabel: string;
  matchNumber: number;
  displayOrder: number;
  groupName?: string;
  participantASeed?: number;
  participantAName?: string;
  participantBSeed?: number;
  participantBName?: string;
  winnerSeed?: number;
  score?: string;
};

export type ParsedScore = {
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  winner: 'A' | 'B';
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
      labels.push('决赛');
    } else if (remaining === 4) {
      labels.push('半决赛');
    } else if (remaining === 8) {
      labels.push('8强');
    } else if (remaining === 16) {
      labels.push('16强');
    } else if (remaining === 32) {
      labels.push('32强');
    } else {
      labels.push(`${remaining}强`);
    }
  }

  return labels;
}

export function buildKnockoutPlan(
  participants: ParticipantSeed[],
  customLabels: string[] = [],
) {
  const bracketSize = nextPowerOfTwo(participants.length);
  const roundLabels = createRoundLabels(bracketSize, customLabels);

  const entries: EntryPlan[] = Array.from({ length: bracketSize }, (_, index) => {
    const participant = participants[index];
    return {
      seed: index + 1,
      entryName: participant?.displayName ?? '轮空',
      participantType: participant?.participantType ?? 'PLAYER',
      playerId: participant?.playerId,
      teamId: participant?.teamId,
      slotNumber: index + 1,
      isBye: !participant,
    };
  });

  const matches: MatchPlan[] = [];
  let displayOrder = 1;

  const firstRoundMatchCount = bracketSize / 2;
  for (let matchIndex = 0; matchIndex < firstRoundMatchCount; matchIndex += 1) {
    const entryA = entries[matchIndex * 2];
    const entryB = entries[matchIndex * 2 + 1];

    const match: MatchPlan = {
      stage: 'KNOCKOUT',
      status: 'PENDING',
      roundNumber: 1,
      roundLabel: roundLabels[0] ?? '首轮',
      matchNumber: matchIndex + 1,
      displayOrder,
      participantASeed: entryA.isBye ? undefined : entryA.seed,
      participantAName: entryA.isBye ? undefined : entryA.entryName,
      participantBSeed: entryB.isBye ? undefined : entryB.seed,
      participantBName: entryB.isBye ? undefined : entryB.entryName,
    };

    if (entryA.isBye !== entryB.isBye) {
      match.status = 'COMPLETED';
      match.score = 'BYE';
      match.winnerSeed = entryA.isBye ? entryB.seed : entryA.seed;
    }

    matches.push(match);
    displayOrder += 1;
  }

  let previousRoundMatches = matches.filter((match) => match.roundNumber === 1);
  for (let roundNumber = 2; roundNumber <= roundLabels.length; roundNumber += 1) {
    const currentRoundMatchCount = previousRoundMatches.length / 2;
    const currentRoundMatches: MatchPlan[] = [];

    for (let matchIndex = 0; matchIndex < currentRoundMatchCount; matchIndex += 1) {
      const feederA = previousRoundMatches[matchIndex * 2];
      const feederB = previousRoundMatches[matchIndex * 2 + 1];

      currentRoundMatches.push({
        stage: 'KNOCKOUT',
        status: 'PENDING',
        roundNumber,
        roundLabel: roundLabels[roundNumber - 1] ?? `第 ${roundNumber} 轮`,
        matchNumber: matchIndex + 1,
        displayOrder,
        participantASeed: feederA?.winnerSeed,
        participantAName: feederA?.winnerSeed
          ? entries.find((entry) => entry.seed === feederA.winnerSeed)?.entryName
          : undefined,
        participantBSeed: feederB?.winnerSeed,
        participantBName: feederB?.winnerSeed
          ? entries.find((entry) => entry.seed === feederB.winnerSeed)?.entryName
          : undefined,
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
) {
  const safeGroupCount = Math.max(1, Math.min(groupCount, participants.length));
  const groupNames = Array.from({ length: safeGroupCount }, (_, index) =>
    String.fromCharCode(65 + index),
  );

  const groups = new Map<string, ParticipantSeed[]>();
  for (const groupName of groupNames) {
    groups.set(groupName, []);
  }

  participants.forEach((participant, index) => {
    const groupName = groupNames[index % safeGroupCount];
    groups.get(groupName)?.push(participant);
  });

  let seed = 1;
  const entries: EntryPlan[] = [];
  const matches: MatchPlan[] = [];
  const seedByName = new Map<string, number>();

  for (const groupName of groupNames) {
    const members = groups.get(groupName) ?? [];
    members.forEach((participant, index) => {
      const entry: EntryPlan = {
        seed,
        entryName: participant.displayName,
        participantType: participant.participantType,
        playerId: participant.playerId,
        teamId: participant.teamId,
        groupName,
        slotNumber: index + 1,
        isBye: false,
      };

      entries.push(entry);
      seedByName.set(participant.displayName, seed);
      seed += 1;
    });
  }

  let matchNumber = 1;
  for (const groupName of groupNames) {
    const groupEntries = entries.filter((entry) => entry.groupName === groupName);
    for (let i = 0; i < groupEntries.length; i += 1) {
      for (let j = i + 1; j < groupEntries.length; j += 1) {
        const entryA = groupEntries[i];
        const entryB = groupEntries[j];

        matches.push({
          stage: 'GROUP',
          status: 'PENDING',
          roundNumber: 1,
          roundLabel: `${groupName}组`,
          matchNumber,
          displayOrder: matchNumber,
          groupName,
          participantASeed: entryA.seed,
          participantAName: entryA.entryName,
          participantBSeed: entryB.seed,
          participantBName: entryB.entryName,
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

export function calculateGroupStandings<
  TEntry extends { id: string; entryName: string; groupName?: string | null },
  TMatch extends {
    groupName?: string | null;
    status?: string | null;
    participantAEntryId?: string | null;
    participantBEntryId?: string | null;
    score?: string | null;
    winnerEntryId?: string | null;
  },
>(entries: TEntry[], matches: TMatch[]) {
  const groups = new Map<string, StandingAccumulator[]>();

  for (const entry of entries) {
    if (!entry.groupName) {
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
    const parsedScore = match.score ? parseScore(match.score) : null;

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

      const netGameDiff =
        right.gamesWon - right.gamesLost - (left.gamesWon - left.gamesLost);
      if (netGameDiff !== 0) {
        return netGameDiff;
      }

      const totalGamesDiff = right.gamesWon - left.gamesWon;
      if (totalGamesDiff !== 0) {
        return totalGamesDiff;
      }

      return left.entryName.localeCompare(right.entryName, 'zh-Hans-CN');
    }),
  }));
}

export function formatRoundRobinMatrix<
  TEntry extends { id: string; entryName: string; groupName?: string | null },
  TMatch extends {
    groupName?: string | null;
    participantAEntryId?: string | null;
    participantBEntryId?: string | null;
    score?: string | null;
    winnerEntryId?: string | null;
  },
>(entries: TEntry[], matches: TMatch[], groupName: string) {
  const groupEntries = entries.filter((entry) => entry.groupName === groupName);

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
        return '待赛';
      }

      if (!match.score) {
        return '待录入';
      }

      if (match.participantAEntryId === rowEntry.id) {
        return match.score;
      }

      return reverseScore(match.score);
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
