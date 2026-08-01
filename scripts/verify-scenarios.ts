import {
  buildKnockoutPlan,
  buildRoundRobinPlan,
  buildTeamBattlePlan,
  calculateGroupStandings,
  calculateTeamBattleSummary,
  evaluateMatchScore,
  formatRoundRobinMatrix,
  getKnockoutSuccessor,
  getMatchStatusLabel,
  isMatchScoreValid,
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

function verifyMatchStatusFlow() {
  // 1. A score line is confirmable only when it evaluates to a valid winner.
  assert(
    isMatchScoreValid(['6', '3', '6'], ['4', '6', '2'], 'BEST_OF_3'),
    'A valid best-of-3 line should be confirmable.',
  );
  assert(
    !isMatchScoreValid(['6', '6', '6'], ['6', '6', '6'], 'BEST_OF_3'),
    'A drawn line should not be confirmable.',
  );
  assert(
    !isMatchScoreValid(['6'], ['4'], 'BEST_OF_3'),
    'An incomplete best-of-3 line should not be confirmable.',
  );
  assert(
    !isMatchScoreValid([], [], 'BEST_OF_3'),
    'An empty line should not be confirmable.',
  );
  assert(
    isMatchScoreValid(['6'], ['4'], 'SINGLE_SET'),
    'A single-set line should be confirmable in single-set format.',
  );

  // 2. English status labels shown on the bracket.
  assert(
    getMatchStatusLabel('IN_PROGRESS') === 'In Progress',
    'In-progress label should be in English.',
  );
  assert(
    getMatchStatusLabel('COMPLETED') === 'Completed',
    'Completed label should be in English.',
  );
  assert(
    getMatchStatusLabel('PENDING') === 'Pending',
    'Pending label should be in English.',
  );

  // 3. Knockout winner propagation target mapping.
  assert(
    getKnockoutSuccessor({ roundNumber: 1, matchNumber: 1 }).matchNumber === 1,
    'R1 M1 winner should feed R2 M1.',
  );
  assert(
    getKnockoutSuccessor({ roundNumber: 1, matchNumber: 2 }).matchNumber === 1,
    'R1 M2 winner should feed R2 M1.',
  );
  assert(
    getKnockoutSuccessor({ roundNumber: 2, matchNumber: 1 }).roundNumber === 3,
    'R2 winner should advance to round 3.',
  );
  assert(
    getKnockoutSuccessor({ roundNumber: 3, matchNumber: 2 }).matchNumber === 1,
    'R3 M2 winner should feed the final (R4 M1).',
  );

  // 4. Winner determination drives the advance.
  const score = assertDefined(
    evaluateMatchScore(['6', '3', '6'], ['4', '6', '2'], 'BEST_OF_3'),
    'Score should evaluate.',
  );
  assert(score.winner === 'A', 'Side A should win this line.');
  assert(score.summary === '6-4, 3-6, 6-2', 'Summary should reflect the score line.');

  // 5. A saved-but-unconfirmed match (IN_PROGRESS) must NOT affect standings;
  //    only a confirmed (COMPLETED) match awards points.
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
  const inProgressMatch = {
    ...baseMatch,
    status: 'IN_PROGRESS',
    participantAScores: score.participantAScores,
    participantBScores: score.participantBScores,
    winnerSide: score.winner,
    winnerEntryId: baseMatch.participantAEntryId,
    score: score.summary,
  };
  let standings = calculateGroupStandings(entries, [inProgressMatch]);
  assert(
    standings[0].standings.every((row) => row.points === 0),
    'An in-progress (unconfirmed) match must not alter standings.',
  );

  const confirmedMatch = { ...inProgressMatch, status: 'COMPLETED' as const };
  standings = calculateGroupStandings(entries, [confirmedMatch]);
  assert(
    standings[0].standings[0].points === 1,
    'A confirmed match should award the point.',
  );

  // 6. Knockout bracket wiring: a four first-round-match draw creates 4 + 2 + 1
  //    matches and the R2 slots are fed by the R1 winners via the successor map.
  const knockoutPlan = buildKnockoutPlan(4, [], 'BEST_OF_3', 'SINGLES');
  const knockoutMatches = knockoutPlan.matches;
  assert(knockoutMatches.length === 7, 'An 8-player knockout should create seven matches.');
  const roundOneMatchOne = assertDefined(
    knockoutMatches.find(
      (match) => match.roundNumber === 1 && match.matchNumber === 1,
    ),
    'Round 1 match 1 should exist.',
  );
  const { roundNumber: r2, matchNumber: r2m } = getKnockoutSuccessor(roundOneMatchOne);
  const roundTwoMatchOne = assertDefined(
    knockoutMatches.find((match) => match.roundNumber === r2 && match.matchNumber === r2m),
    'The R1 M1 winner slot should exist in round 2.',
  );
  assert(
    roundTwoMatchOne.participantASeeds === null ||
      roundTwoMatchOne.participantASeeds === undefined ||
      roundTwoMatchOne.participantASeeds.length === 0,
    'The R2 winner slot should start empty and only fill after the match is confirmed.',
  );

  return {
    confirmable: true,
    inProgressLocked: true,
    r1M1Feeds: { roundNumber: r2, matchNumber: r2m },
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
    2,
    'SINGLE_SET',
  );

  assert(plan.entries.length === 12, 'Three teams should generate twelve entries.');
  assert(plan.matches.length === 18, 'Three teams of four should generate eighteen matches.');

  const duelLabels = [...new Set(plan.matches.map((match) => match.roundLabel))];
  assert(duelLabels.length === 3, 'Three teams should create three duel groups.');

  // Schedule composition rule: every duel must contain exactly 4 singles and
  // 2 doubles submatches (teamSize = 4), each side seeded with one player for
  // singles and two players for doubles.
  for (const duelLabel of duelLabels) {
    const duelMatches = plan.matches.filter((match) => match.roundLabel === duelLabel);
    const singles = duelMatches.filter((match) => match.groupName === 'Singles');
    const doubles = duelMatches.filter((match) => match.groupName === 'Doubles');
    assert(
      singles.length === 4,
      `Duel ${duelLabel} should contain exactly four singles submatches.`,
    );
    assert(
      doubles.length === 2,
      `Duel ${duelLabel} should contain exactly two doubles submatches.`,
    );
    assert(
      singles.every(
        (match) =>
          (match.participantASeeds?.length ?? 0) === 1 &&
          (match.participantBSeeds?.length ?? 0) === 1,
      ),
      `Every singles submatch in ${duelLabel} should seed one player per side.`,
    );
    assert(
      doubles.every(
        (match) =>
          (match.participantASeeds?.length ?? 0) === 2 &&
          (match.participantBSeeds?.length ?? 0) === 2,
      ),
      `Every doubles submatch in ${duelLabel} should seed two players per side.`,
    );
  }

  // Configurability: the generated schedule must match the requested
  // singles/doubles counts exactly for arbitrary non-default values.
  const customPlan = buildTeamBattlePlan(participants, 3, 3, 1, 'BEST_OF_3');
  const customDuelCount = 3;
  const customRosterSize = Math.max(3, 1 * 2);
  assert(
    customPlan.entries.length === 3 * customRosterSize,
    'Custom plan should create rosterSize slots per team.',
  );
  assert(
    customPlan.matches.length === customDuelCount * (3 + 1),
    'Custom plan should generate exactly 3 singles + 1 doubles per duel.',
  );
  const customDuelLabels = [...new Set(customPlan.matches.map((match) => match.roundLabel))];
  for (const duelLabel of customDuelLabels) {
    const duelMatches = customPlan.matches.filter((match) => match.roundLabel === duelLabel);
    assert(
      duelMatches.filter((match) => match.groupName === 'Singles').length === 3,
      `Custom duel ${duelLabel} should contain exactly three singles.`,
    );
    assert(
      duelMatches.filter((match) => match.groupName === 'Doubles').length === 1,
      `Custom duel ${duelLabel} should contain exactly one doubles.`,
    );
  }

  const alphaVsBeta = plan.matches
    .filter((match) => match.roundLabel === 'Team A vs Team B')
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
    duelSummary.teams.find((team) => team.teamLabel === 'Team A'),
    'Team summary should include Team A.',
  );
  const beta = assertDefined(
    duelSummary.teams.find((team) => team.teamLabel === 'Team B'),
    'Team summary should include Team B.',
  );
  assert(alpha.matchWins === 3 && beta.matchWins === 0, 'Duel wins should accumulate correctly.');
  assert(
    assertDefined(duelSummary.winner, 'Team duel winner should exist.').teamLabel === 'Team A',
    'Duel winner should resolve correctly.',
  );

  // Unconfirmed team submatches must not count towards the duel result.
  const unconfirmedDuel = alphaVsBeta.map((match) => ({
    ...match,
    status: 'IN_PROGRESS',
  }));
  const unconfirmedSummary = calculateTeamBattleSummary(unconfirmedDuel);
  const unconfirmedAlpha = assertDefined(
    unconfirmedSummary.teams.find((team) => team.teamLabel === 'Team A'),
    'Team summary should still include Team A.',
  );
  assert(
    unconfirmedAlpha.matchWins === 0,
    'In-progress submatches must not count as match wins before confirmation.',
  );

  return {
    duelLabels,
    totalSubmatches: plan.matches.length,
    alphaMatchWinsVsBeta: alpha.matchWins,
    betaMatchWinsVsAlpha: beta.matchWins,
    unconfirmedMatchWins: unconfirmedAlpha.matchWins,
  };
}

function verifyKnockoutByeFlow() {
  // 1. A full (power-of-two) first round has no BYEs at all.
  const fullPlan = buildKnockoutPlan(4, [], 'BEST_OF_3', 'SINGLES');
  assert(fullPlan.bracketSize === 8, 'Four first-round matches should create an 8-slot bracket.');
  assert(
    fullPlan.entries.every((entry) => !entry.isBye),
    'A full draw should contain no BYE slots.',
  );
  assert(
    fullPlan.matches.every((match) => match.score !== 'BYE'),
    'A full draw should contain no BYE matches.',
  );

  // 2. An odd first-round count pads the bracket and places BYEs from the edges
  //    inward so both halves of the draw receive them evenly.
  const oddPlan = buildKnockoutPlan(3, [], 'BEST_OF_3', 'SINGLES');
  assert(oddPlan.bracketSize === 8, 'Three first-round matches still need an 8-slot bracket.');
  assert(oddPlan.matches.length === 7, 'An 8-slot bracket should generate seven matches.');

  const byeEntries = oddPlan.entries.filter((entry) => entry.isBye);
  assert(byeEntries.length === 2, 'Three first-round matches should create two BYEs.');
  const byeSlots = byeEntries.map((entry) => entry.slotNumber).sort((a, b) => a - b);
  assert(
    byeSlots[0] === 1 && byeSlots[1] === 8,
    'BYEs should sit at the bracket edges (slots 1 and 8).',
  );

  const roundOne = oddPlan.matches.filter((match) => match.roundNumber === 1);
  assert(roundOne.length === 4, 'Round 1 should contain four matches in an 8-slot bracket.');
  const byeMatches = roundOne.filter((match) => match.score === 'BYE');
  assert(byeMatches.length === 2, 'Two first-round matches should be marked BYE.');
  assert(
    byeMatches.every(
      (match) => match.participantAName === 'BYE' || match.participantBName === 'BYE',
    ),
    'Every BYE match must have exactly one BYE side.',
  );

  // 3. Later rounds cascade from the first round via the successor mapping.
  assert(oddPlan.roundLabels.length === 3, 'An 8-slot bracket should have three rounds.');
  assert(oddPlan.roundLabels[2] === 'Final', 'The last round should be the Final.');
  for (let round = 2; round <= oddPlan.roundLabels.length; round += 1) {
    const roundMatches = oddPlan.matches.filter((match) => match.roundNumber === round);
    const expectedCount = 4 / 2 ** (round - 1);
    assert(
      roundMatches.length === expectedCount,
      `Round ${round} should contain ${expectedCount} matches.`,
    );
  }

  const byeMatch = assertDefined(
    byeMatches.find((match) => match.participantAName === 'BYE'),
    'A first-round match with a BYE on side A should exist.',
  );
  const { roundNumber: nextRound, matchNumber: nextMatch } = getKnockoutSuccessor(byeMatch);
  const successor = assertDefined(
    oddPlan.matches.find(
      (match) => match.roundNumber === nextRound && match.matchNumber === nextMatch,
    ),
    'The successor of a BYE match should exist.',
  );
  assert(
    successor.participantASeeds === null ||
      successor.participantASeeds === undefined ||
      successor.participantASeeds.length === 0,
    'The successor winner slot should start empty until the BYE match is resolved.',
  );

  // 4. A 10-participant draw (5 first-round matches) pads to 16 slots with six
  //    BYEs, and the BYE slots stay symmetric around the bracket.
  const tenPlan = buildKnockoutPlan(5, [], 'BEST_OF_3', 'SINGLES');
  assert(tenPlan.bracketSize === 16, 'Five first-round matches should pad to a 16-slot bracket.');
  assert(
    tenPlan.entries.filter((entry) => entry.isBye).length === 6,
    'A 10-participant draw should contain six BYEs.',
  );
  const tenByeSlots = tenPlan.entries
    .filter((entry) => entry.isBye)
    .map((entry) => entry.slotNumber)
    .sort((a, b) => a - b);
  for (const slot of tenByeSlots) {
    assert(
      tenByeSlots.includes(17 - slot),
      `BYE slot ${slot} should be mirrored by slot ${17 - slot}.`,
    );
  }

  // 5. Doubles events reuse the same bracket logic with doubles categories.
  const doublesPlan = buildKnockoutPlan(3, [], 'BEST_OF_5', 'DOUBLES');
  assert(
    doublesPlan.matches.every((match) => match.matchCategory === 'STANDARD_DOUBLES'),
    'Doubles events should generate STANDARD_DOUBLES matches.',
  );

  return {
    bracketSize: oddPlan.bracketSize,
    totalMatches: oddPlan.matches.length,
    byeSlots,
    byeMatches: byeMatches.length,
  };
}

const result = {
  roundRobin: verifyRoundRobinRealtimeFlow(),
  matchStatusFlow: verifyMatchStatusFlow(),
  teamBattle: verifyMultiTeamBattleFlow(),
  knockoutBye: verifyKnockoutByeFlow(),
  checks: 'passed',
};

console.log(JSON.stringify(result, null, 2));
