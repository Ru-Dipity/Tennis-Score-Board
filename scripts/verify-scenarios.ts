import {
  buildRoundRobinPlan,
  buildTeamBattlePlan,
  calculateGroupStandings,
  calculateTeamBattleSummary,
  evaluateMatchScore,
  formatRoundRobinMatrix,
} from '../src/lib/tournament';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function verifyRoundRobinRealtimeFlow() {
  const participants = [
    { sourceId: 'p1', displayName: 'Alice', participantType: 'PLAYER' as const, playerId: 'p1' },
    { sourceId: 'p2', displayName: 'Bella', participantType: 'PLAYER' as const, playerId: 'p2' },
  ];
  const plan = buildRoundRobinPlan(participants, 1, 'BEST_OF_3', 'SINGLES');
  const entries = plan.entries.map((entry, index) => ({ ...entry, id: `entry-${index + 1}` }));
  const matchPlan = plan.matches[0];
  const seedToEntryId = new Map(entries.map((entry) => [entry.seed, entry.id]));

  const baseMatch = {
    id: 'match-1',
    ...matchPlan,
    participantAEntryId: seedToEntryId.get(matchPlan.participantASeeds?.[0] ?? -1),
    participantBEntryId: seedToEntryId.get(matchPlan.participantBSeeds?.[0] ?? -1),
  };

  let standings = calculateGroupStandings(entries, [baseMatch]);
  assert(
    standings[0].standings.every((row) => row.points === 0),
    'Round robin should start with zero points.',
  );

  const initialScore = assertDefined(
    evaluateMatchScore(['6', '3', '6'], ['4', '6', '2'], 'BEST_OF_3'),
    'Initial round robin score should evaluate.',
  );
  const savedMatch = {
    ...baseMatch,
    status: 'COMPLETED',
    participantAScores: initialScore.participantAScores,
    participantBScores: initialScore.participantBScores,
    winnerSide: initialScore.winner,
    winnerEntryId:
      initialScore.winner === 'A'
        ? baseMatch.participantAEntryId
        : baseMatch.participantBEntryId,
    score: initialScore.summary,
  };

  standings = calculateGroupStandings(entries, [savedMatch]);
  assert(standings[0].standings[0].entryName === 'Alice', 'Alice should lead after save.');
  assert(standings[0].standings[0].points === 1, 'Winner should receive one point.');
  assert(standings[0].standings[0].gamesWon === 15, 'Games won should update on save.');

  const matrixAfterSave = formatRoundRobinMatrix(entries, [savedMatch], 'A');
  assert(
    String(matrixAfterSave[0].cells[1]).includes('6-4'),
    'Matrix should show saved score immediately.',
  );

  const clearedMatch = {
    ...baseMatch,
    status: 'IN_PROGRESS',
    participantAScores: null,
    participantBScores: null,
    winnerSide: null,
    winnerEntryId: null,
    score: null,
  };
  standings = calculateGroupStandings(entries, [clearedMatch]);
  assert(
    standings[0].standings.every((row) => row.points === 0),
    'Deleting a score should reset standings immediately.',
  );

  const resubmittedScore = assertDefined(
    evaluateMatchScore(['4', '6', '2'], ['6', '3', '6'], 'BEST_OF_3'),
    'Resubmitted round robin score should evaluate.',
  );
  const resubmittedMatch = {
    ...baseMatch,
    status: 'COMPLETED',
    participantAScores: resubmittedScore.participantAScores,
    participantBScores: resubmittedScore.participantBScores,
    winnerSide: resubmittedScore.winner,
    winnerEntryId:
      resubmittedScore.winner === 'A'
        ? baseMatch.participantAEntryId
        : baseMatch.participantBEntryId,
    score: resubmittedScore.summary,
  };
  standings = calculateGroupStandings(entries, [resubmittedMatch]);
  assert(
    standings[0].standings[0].entryName === 'Bella',
    'Edited score should immediately reorder the table.',
  );

  return {
    leaderAfterResubmit: standings[0].standings[0].entryName,
    matrixAfterSave: matrixAfterSave[0].cells[1],
  };
}

function verifyMultiTeamBattleFlow() {
  const participants = Array.from({ length: 12 }, (_, index) => ({
    sourceId: `tp-${index + 1}`,
    displayName: `Player ${index + 1}`,
    participantType: 'PLAYER' as const,
    playerId: `tp-${index + 1}`,
  }));

  const plan = buildTeamBattlePlan(
    participants,
    3,
    4,
    ['Alpha', 'Beta', 'Gamma'],
    'SINGLE_SET',
  );

  assert(plan.entries.length === 12, 'Three teams should generate twelve entries.');
  assert(plan.matches.length === 18, 'Three teams of four should generate eighteen matches.');

  const duelLabels = [...new Set(plan.matches.map((match) => match.roundLabel))];
  assert(duelLabels.length === 3, 'Three teams should create three duel groups.');

  const alphaVsBeta = plan.matches
    .filter((match) => match.roundLabel === 'Alpha vs Beta')
    .slice(0, 3)
    .map((match, index) => ({
      ...match,
      status: 'COMPLETED',
      participantAScores: [6],
      participantBScores: [4 + index],
      winnerSide: 'A' as const,
      score: `6-${4 + index}`,
    }));

  const duelSummary = calculateTeamBattleSummary(alphaVsBeta);
  const alpha = assertDefined(
    duelSummary.teams.find((team) => team.teamLabel === 'Alpha'),
    'Team summary should include Alpha.',
  );
  const beta = assertDefined(
    duelSummary.teams.find((team) => team.teamLabel === 'Beta'),
    'Team summary should include Beta.',
  );
  assert(alpha.matchWins === 3 && beta.matchWins === 0, 'Duel wins should accumulate correctly.');
  assert(
    assertDefined(duelSummary.winner, 'Team duel winner should exist.').teamLabel === 'Alpha',
    'Duel winner should resolve correctly.',
  );

  return {
    duelLabels,
    totalSubmatches: plan.matches.length,
    alphaMatchWinsVsBeta: alpha.matchWins,
    betaMatchWinsVsAlpha: beta.matchWins,
  };
}

const result = {
  roundRobin: verifyRoundRobinRealtimeFlow(),
  teamBattle: verifyMultiTeamBattleFlow(),
  checks: 'passed',
};

console.log(JSON.stringify(result, null, 2));
