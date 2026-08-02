import {
  buildKnockoutPlan,
  buildRoundRobinPlan,
  buildTeamBattlePlan,
  calculateGroupStandings,
  calculateTeamBattleSummary,
  evaluateMatchScore,
  formatRoundRobinMatrix,
  getKnockoutByeCount,
  getKnockoutByeSlots,
  getKnockoutSuccessor,
  getMatchStatusLabel,
  isMatchScoreValid,
  nextPowerOfTwo,
  validateKnockoutByeRule,
  type MatchPlan,
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

  // 6. Knockout bracket wiring: an 8-participant draw creates 4 + 2 + 1
  //    matches and the R2 slots are fed by the R1 winners via the successor map.
  const knockoutPlan = buildKnockoutPlan(8, [], 'BEST_OF_3', 'SINGLES');
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
  // 1. A full power-of-two draw pairs everyone and creates no BYEs at all.
  const fullPlan = buildKnockoutPlan(8, [], 'BEST_OF_3', 'SINGLES');
  assert(fullPlan.bracketSize === 8, 'Eight participants should produce an 8-slot bracket.');
  assert(
    fullPlan.entries.every((entry) => !entry.isBye),
    'A full draw should contain no BYE slots.',
  );
  assert(
    fullPlan.matches.every((match) => match.score !== 'BYE'),
    'A full draw should contain no BYE matches.',
  );
  assert(fullPlan.matches.length === 7, 'An 8-player knockout should create seven matches.');
  assert(
    fullPlan.roundLabels[fullPlan.roundLabels.length - 1] === 'Final',
    'The last round should be the Final.',
  );

  // 2. Power-of-two bracket padding: for ANY participant count the bracket is
  //    padded up to the next power of two and the difference becomes round-1
  //    BYEs, so round 1 (BYE auto-advances included) starts with 2^n teams.
  const oddPlan = buildKnockoutPlan(7, [], 'BEST_OF_3', 'SINGLES');
  assert(oddPlan.bracketSize === 8, 'Seven participants should pad to an 8-slot bracket.');
  assert(oddPlan.matches.length === 7, 'A 7-participant knockout should create seven matches.');
  assert(oddPlan.roundLabels.length === 3, 'A 7-participant draw should have three rounds.');
  assert(oddPlan.roundLabels[2] === 'Final', 'The last round should be the Final.');

  const roundOne = oddPlan.matches.filter((match) => match.roundNumber === 1);
  assert(roundOne.length === 4, 'Round 1 should contain three pairings plus one BYE match.');
  const roundOneByeMatches = roundOne.filter((match) => match.score === 'BYE');
  assert(
    roundOneByeMatches.length === 1,
    'An odd draw should create exactly one BYE in round 1.',
  );
  const byeMatch = assertDefined(roundOneByeMatches[0], 'The round-1 BYE match should exist.');
  assert(
    byeMatch.participantAName === 'BYE' || byeMatch.participantBName === 'BYE',
    'A BYE match must have exactly one BYE side.',
  );
  assert(
    roundOne
      .filter((match) => match.score !== 'BYE')
      .every(
        (match) =>
          match.participantASeeds?.length === 1 && match.participantBSeeds?.length === 1,
      ),
    'All non-BYE round-1 pairings must contain two real seeds.',
  );

  // 3. BYEs are strictly a round-1 rule: no later round of a generated plan
  //    may hold a BYE, and every later round must be a full pairing.
  assert(
    oddPlan.matches.filter((match) => match.roundNumber > 1 && match.score === 'BYE').length === 0,
    'No BYE may exist after round 1 in a generated plan.',
  );
  assert(
    oddPlan.matches.filter((match) => match.roundNumber === 2).length === 2,
    'Round 2 should contain two matches.',
  );
  assert(
    oddPlan.matches.filter((match) => match.roundNumber === 3).length === 1,
    'Round 3 should contain the Final.',
  );

  // 4. An even non-power-of-two count also gets round-1 BYEs (2 for 6): the
  //    bracket pads to 8 with BYE slots at the outer edges (1 and 8).
  const sixPlan = buildKnockoutPlan(6, [], 'BEST_OF_3', 'SINGLES');
  assert(sixPlan.bracketSize === 8, 'Six participants should pad to an 8-slot bracket.');
  const sixRoundOne = sixPlan.matches.filter((match) => match.roundNumber === 1);
  assert(sixRoundOne.length === 4, 'Round 1 should contain two pairings plus two BYE matches.');
  assert(
    sixPlan.matches.filter((match) => match.score === 'BYE').length === 2,
    'A 6-participant draw should place exactly two BYEs in round 1.',
  );
  assert(
    sixPlan.matches.filter((match) => match.roundNumber > 1 && match.score === 'BYE').length === 0,
    'A 6-participant draw must not cascade a BYE into round 2 or beyond.',
  );

  // 5. BYE slot symmetry: for 6 participants the padded 8-slot bracket places
  //    BYEs on slot 1 and slot 8 (outer edges of each half of the draw).
  const sixByeSlots = sixPlan.entries
    .filter((entry) => entry.isBye)
    .map((entry) => entry.slotNumber)
    .sort((a, b) => a - b);
  assert(
    sixByeSlots.length === 2 && sixByeSlots[0] === 1 && sixByeSlots[1] === 8,
    'Six participants should BYE at slots 1 and 8.',
  );

  // 6. Doubles events reuse the same bracket logic with doubles categories.
  const doublesPlan = buildKnockoutPlan(5, [], 'BEST_OF_5', 'DOUBLES');
  assert(doublesPlan.bracketSize === 8, 'Five doubles teams should pad to an 8-slot bracket.');
  assert(
    doublesPlan.matches.every((match) => match.matchCategory === 'STANDARD_DOUBLES'),
    'Doubles events should generate STANDARD_DOUBLES matches.',
  );
  assert(
    doublesPlan.matches.filter((match) => match.roundNumber > 1 && match.score === 'BYE').length ===
      0,
    'Doubles draws must also keep every BYE in round 1.',
  );

  // 7. Multi-scenario boundary sweep: for every participant count 2..16 the
  //    round-1 BYE count must match the power-of-two formula, all BYEs must
  //    live in round 1, every later round must be a full pairing, and the
  //    generated plan must pass the rule-compliance checker.
  const byesPerPlan: Record<number, number> = {};
  const roundStructure: Record<number, number[]> = {};
  for (let count = 2; count <= 16; count += 1) {
    const plan = buildKnockoutPlan(count, [], 'BEST_OF_3', 'SINGLES');
    const expectedBracket = nextPowerOfTwo(count);
    const expectedByes = getKnockoutByeCount(count);
    assert(
      plan.bracketSize === expectedBracket,
      `Count ${count} should pad to ${expectedBracket} slots, got ${plan.bracketSize}.`,
    );
    const byeMatches = plan.matches.filter((match) => match.score === 'BYE');
    assert(
      byeMatches.length === expectedByes,
      `Count ${count} should create ${expectedByes} round-1 BYEs, got ${byeMatches.length}.`,
    );
    assert(
      byeMatches.every((match) => match.roundNumber === 1),
      `Count ${count}: every BYE must be in round 1.`,
    );
    assert(
      plan.matches.filter((match) => match.roundNumber > 1 && match.score === 'BYE').length === 0,
      `Count ${count}: no BYE may exist after round 1.`,
    );

    const roundCounts = new Map<number, number>();
    for (const match of plan.matches) {
      roundCounts.set(match.roundNumber, (roundCounts.get(match.roundNumber) ?? 0) + 1);
    }
    for (const [roundNumber, matchesInRound] of roundCounts) {
      const expected =
        roundNumber === 1 ? plan.bracketSize / 2 : plan.bracketSize / 2 ** roundNumber;
      assert(
        matchesInRound === expected,
        `Count ${count}, round ${roundNumber}: expected ${expected} matches, got ${matchesInRound}.`,
      );
    }
    assert(
      plan.bracketSize / 2 ** roundCounts.size === 1,
      `Count ${count}: the last round should contain exactly one match.`,
    );

    const validation = validateKnockoutByeRule(plan);
    assert(
      validation.valid,
      `Count ${count}: validateKnockoutByeRule should pass (${validation.errors.join('; ')}).`,
    );
    byesPerPlan[count] = byeMatches.length;
    roundStructure[count] = [...roundCounts.values()];
  }

  // 8. Round-1 BYE formula correctness for the sweep.
  for (let count = 2; count <= 16; count += 1) {
    assert(
      getKnockoutByeCount(count) === nextPowerOfTwo(count) - count,
      `BYE formula for ${count} participants should be nextPowerOfTwo - count.`,
    );
  }
  assert(getKnockoutByeCount(2) === 0, 'Two participants need no BYEs.');
  assert(getKnockoutByeCount(3) === 1, 'Three participants need one BYE.');
  assert(getKnockoutByeCount(8) === 0, 'Eight participants need no BYEs.');
  assert(getKnockoutByeCount(9) === 7, 'Nine participants need seven BYEs.');

  // 9. getKnockoutByeSlots never places two BYEs in the same round-1 match
  //    and always keeps every slot inside the bracket.
  for (let count = 2; count <= 16; count += 1) {
    const bracket = nextPowerOfTwo(count);
    const byeCount = getKnockoutByeCount(count);
    const slots = [...getKnockoutByeSlots(bracket, byeCount)].sort((a, b) => a - b);
    assert(
      slots.every((slot) => slot >= 1 && slot <= bracket),
      `BYE slots for ${count} participants must stay inside the bracket.`,
    );
    for (let index = 0; index < slots.length - 1; index += 1) {
      assert(
        slots[index + 1] - slots[index] !== 1,
        `BYE slots for ${count} participants must never occupy both sides of one match.`,
      );
    }
  }

  return {
    bracketSize: oddPlan.bracketSize,
    totalMatches: oddPlan.matches.length,
    roundOneByes: roundOneByeMatches.length,
    sixByeSlots,
    byesPerPlan,
    roundStructure,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Participant selection dropdowns — mirror the singles/doubles dropdowns in
// src/App.tsx (renderStandardModalParticipantSelect,
// renderDoublesModalParticipantSelects, renderEditableParticipantSelect and
// updateMatchParticipant) so the editable re-select + TBD behaviours can be
// verified deterministically without a browser (the scoring modal is
// admin-only).
// ───────────────────────────────────────────────────────────────────────────

type StoredMatch = {
  id: string;
  participantAEntryId: string | null;
  participantAEntryIds: string[] | null;
  participantBEntryId: string | null;
  participantBEntryIds: string[] | null;
  participantAName?: string;
  participantBName?: string;
};

function getMatchEntryIds(match: StoredMatch, side: 'A' | 'B') {
  const entryIds =
    side === 'A' ? match.participantAEntryIds ?? [] : match.participantBEntryIds ?? [];
  const singleEntryId = side === 'A' ? match.participantAEntryId : match.participantBEntryId;
  if (entryIds.length) {
    return entryIds;
  }
  return singleEntryId ? [singleEntryId] : [];
}

// Mirror of updateMatchParticipant's payload logic in src/App.tsx. Round-robin
// (stage GROUP) sides keep their slot entry id so standings / matrix resolve;
// knockout sides are replaced by the picked ids.
function applyParticipantUpdate(
  match: StoredMatch,
  side: 'A' | 'B',
  entryIds: string[],
  entryName: string,
  options?: { roundRobin?: boolean },
): StoredMatch {
  const nextIds = entryIds.filter(Boolean);
  const isRoundRobin = options?.roundRobin === true;
  const updated: StoredMatch = { ...match };
  if (side === 'A') {
    updated.participantAEntryId = isRoundRobin
      ? match.participantAEntryId
      : nextIds.length === 1
        ? nextIds[0]
        : null;
    updated.participantAEntryIds = nextIds.length ? nextIds : null;
    updated.participantAName = entryName;
  } else {
    updated.participantBEntryId = isRoundRobin
      ? match.participantBEntryId
      : nextIds.length === 1
        ? nextIds[0]
        : null;
    updated.participantBEntryIds = nextIds.length ? nextIds : null;
    updated.participantBName = entryName;
  }
  return updated;
}

// Mirror of syncRoundRobinSlotEntry: the round-robin slot entry mirrors the
// assigned participant (or reverts to TBD) so standings rows show real names.
function syncRoundRobinSlotEntry(
  entry: { id: string; entryName: string; playerId?: string | null; teamId?: string | null },
  boundIds: string[],
  boundName: string,
) {
  const boundId = boundIds.length === 1 ? boundIds[0] : null;
  const boundIsTeam = Boolean(boundId && boundId.startsWith('team-'));
  return {
    ...entry,
    entryName: boundName || 'TBD',
    playerId: boundId && !boundIsTeam ? boundId : null,
    teamId: boundId && boundIsTeam ? boundId : null,
  };
}

// Doubles knockout dropdown mirror: each side exposes two selects (Player 1 /
// Player 2) whose options are the playable players. Only ids that resolve to a
// real player may occupy a slot; a TBD selection clears that slot; re-selecting
// a bound slot replaces it (freely editable). Re-create the dropdown after each
// commit — the real component recomputes slots on every render.
function createDoublesDropdown(players: { id: string; name: string }[], storedIds: string[]) {
  const playerIdToName = new Map(players.map((player) => [player.id, player.name]));
  const validSlotIds = storedIds.filter((id) => playerIdToName.has(id));
  const slotIds: (string | undefined)[] = [validSlotIds[0], validSlotIds[1]];

  const commitSlot = (slotIndex: number, nextId: string | null) => {
    const next = [...validSlotIds];
    if (nextId) {
      next[slotIndex] = nextId;
    } else {
      next.splice(slotIndex, 1);
    }
    const ids = next.filter(Boolean);
    const name = ids.length
      ? ids.map((id) => playerIdToName.get(id) ?? 'TBD').join(' / ')
      : 'TBD';
    return { entryIds: ids, entryName: name };
  };

  return { slotIds, commitSlot };
}

function verifyDoublesKnockoutDropdownFlow() {
  const players = [
    { id: 'player-1', name: 'Alice' },
    { id: 'player-2', name: 'Bella' },
    { id: 'player-3', name: 'Cara' },
    { id: 'player-4', name: 'Dora' },
    { id: 'player-5', name: 'Eva' },
  ];

  // Real 4-participant doubles knockout plan mapped the same way the app
  // persists it: fresh sides pre-fill with the bracket slot's TournamentEntry
  // id (created at tournament build time) — which is NOT a Player id.
  const plan = buildKnockoutPlan(4, [], 'BEST_OF_3', 'DOUBLES');
  const entries = plan.entries.map((entry, index) => ({ ...entry, id: `entry-${index + 1}` }));
  const seedToEntryId = new Map(entries.map((entry) => [entry.seed, entry.id]));
  const roundOneMatch = assertDefined(
    plan.matches.find((match) => match.roundNumber === 1),
    'A 4-participant doubles knockout should contain a round-1 match.',
  );
  const makeStoredMatch = (planMatch: MatchPlan): StoredMatch => {
    const aEntryIds = (planMatch.participantASeeds ?? [])
      .map((seed) => seedToEntryId.get(seed))
      .filter((id): id is string => Boolean(id));
    const bEntryIds = (planMatch.participantBSeeds ?? [])
      .map((seed) => seedToEntryId.get(seed))
      .filter((id): id is string => Boolean(id));
    return {
      id: 'match-1',
      ...planMatch,
      participantAEntryId: aEntryIds[0] ?? null,
      participantAEntryIds: aEntryIds.length ? aEntryIds : null,
      participantBEntryId: bEntryIds[0] ?? null,
      participantBEntryIds: bEntryIds.length ? bEntryIds : null,
    };
  };
  let match = makeStoredMatch(roundOneMatch);

  // Root-cause precondition: fresh stored ids are phantom TournamentEntry ids,
  // not Player ids. They must never occupy a dropdown slot.
  const freshA = getMatchEntryIds(match, 'A');
  assert(
    freshA.length === 1 && !players.some((player) => player.id === freshA[0]),
    'Fresh side A should carry a phantom TournamentEntry id.',
  );
  let dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  assert(
    dropdown.slotIds[0] === undefined && dropdown.slotIds[1] === undefined,
    'The phantom TournamentEntry id must not occupy the Player-1 dropdown.',
  );

  // ── Bind Player 1, then Player 2 (independent dropdowns) ───────────────
  let commit = dropdown.commitSlot(0, 'player-1');
  assert(
    commit.entryIds.length === 1 && commit.entryIds[0] === 'player-1',
    'Selecting Player 1 must commit exactly that player (no phantom id leaked).',
  );
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    match.participantAEntryIds?.length === 1 && match.participantAName === 'Alice',
    'Selecting Player 1 must persist exactly that player.',
  );

  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  commit = dropdown.commitSlot(1, 'player-2');
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    match.participantAEntryIds?.length === 2 && match.participantAName === 'Alice / Bella',
    'A complete pair should persist both players and a " / " name.',
  );

  // ── Editable: re-select Player 1 to a different player ─────────────────
  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  assert(
    dropdown.slotIds[0] === 'player-1' && dropdown.slotIds[1] === 'player-2',
    'Re-opening the dropdown must show the bound players in their slots.',
  );
  commit = dropdown.commitSlot(0, 'player-3');
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    match.participantAEntryIds?.[0] === 'player-3' && match.participantAName === 'Cara / Bella',
    'Re-selecting Player 1 must replace only that slot.',
  );

  // ── TBD: clear Player 2, then Player 1 ─────────────────────────────────
  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  commit = dropdown.commitSlot(1, null);
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    match.participantAEntryIds?.length === 1 && match.participantAName === 'Cara',
    'Selecting TBD on Player 2 must drop that player from the side.',
  );

  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  commit = dropdown.commitSlot(0, null);
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    !match.participantAEntryIds?.length && match.participantAName === 'TBD',
    'Selecting TBD on the last bound slot must leave the side TBD.',
  );

  // ── Rebind after TBD — the side stays fully editable ───────────────────
  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  commit = dropdown.commitSlot(0, 'player-4');
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  dropdown = createDoublesDropdown(players, getMatchEntryIds(match, 'A'));
  commit = dropdown.commitSlot(1, 'player-5');
  match = applyParticipantUpdate(match, 'A', commit.entryIds, commit.entryName);
  assert(
    match.participantAName === 'Dora / Eva',
    'The side must be re-bindable after a TBD reset.',
  );

  return {
    phantomIgnored: true,
    completePair: 'Alice / Bella',
    editedPair: 'Cara / Bella',
    tbdClearedSide: match.participantAName,
    reboundPair: 'Dora / Eva',
  };
}

function verifyParticipantSelectEditableTbdFlow() {
  const players = [
    { id: 'player-1', name: 'Alice' },
    { id: 'player-2', name: 'Bella' },
    { id: 'player-3', name: 'Cara' },
  ];

  const optionOf = (match: StoredMatch, side: 'A' | 'B') => {
    const currentName = side === 'A' ? match.participantAName : match.participantBName;
    return players.find((player) => player.name === currentName)?.id ?? '';
  };

  const selectOption = (
    match: StoredMatch,
    side: 'A' | 'B',
    value: string,
    options?: { roundRobin?: boolean },
  ) => {
    if (value === '__tbd__') {
      return applyParticipantUpdate(match, side, [], 'TBD', options);
    }
    const option = players.find((player) => player.id === value);
    if (!option) {
      return match;
    }
    return applyParticipantUpdate(match, side, [value], option.name, options);
  };

  let match: StoredMatch = {
    id: 'match-1',
    participantAEntryId: null,
    participantAEntryIds: null,
    participantBEntryId: null,
    participantBEntryIds: null,
    participantAName: 'TBD',
    participantBName: 'TBD',
  };

  // Placeholder state — nothing assigned yet.
  assert(optionOf(match, 'A') === '', 'An unassigned side should show its TBD placeholder.');
  assert(
    players.every((player) => player.id !== optionOf(match, 'A')),
    'The unassigned placeholder must never be an option value.',
  );

  // Select a player.
  match = selectOption(match, 'A', 'player-1');
  assert(
    match.participantAName === 'Alice' && match.participantAEntryId === 'player-1',
    'Selecting a player must bind the side.',
  );

  // Editable: re-select to another player.
  match = selectOption(match, 'A', 'player-2');
  assert(match.participantAName === 'Bella', 'Re-selecting must replace the bound player.');
  assert(optionOf(match, 'A') === 'player-2', 'The dropdown must reflect the re-selected player.');

  // TBD clears the side.
  match = selectOption(match, 'A', '__tbd__');
  assert(
    match.participantAName === 'TBD' && !match.participantAEntryIds?.length,
    'Selecting TBD must clear the side back to undecided.',
  );

  // Round robin variant: the slot entry id is preserved across assignment and
  // TBD so standings / matrix keep resolving the same slot; the slot entry
  // mirrors the bound player (or reverts to TBD).
  let rrMatch: StoredMatch = {
    id: 'rr-match-1',
    participantAEntryId: 'slot-entry-7',
    participantAEntryIds: null,
    participantBEntryId: 'slot-entry-8',
    participantBEntryIds: null,
    participantAName: 'TBD',
    participantBName: 'TBD',
  };
  const rrOptions = { roundRobin: true };
  rrMatch = selectOption(rrMatch, 'A', 'player-3', rrOptions);
  assert(
    rrMatch.participantAName === 'Cara' && rrMatch.participantAEntryId === 'slot-entry-7',
    'Round robin assignment must keep the slot entry id in participantAEntryId.',
  );
  const syncedEntry = syncRoundRobinSlotEntry(
    { id: 'slot-entry-7', entryName: 'TBD' },
    rrMatch.participantAEntryIds ?? [],
    rrMatch.participantAName ?? 'TBD',
  );
  assert(
    syncedEntry.entryName === 'Cara' && syncedEntry.playerId === 'player-3',
    'The round-robin slot entry must mirror the assigned player.',
  );
  rrMatch = selectOption(rrMatch, 'A', '__tbd__', rrOptions);
  assert(
    rrMatch.participantAName === 'TBD' && rrMatch.participantAEntryId === 'slot-entry-7',
    'Round robin TBD must keep the slot entry id while clearing the participant.',
  );
  const syncedAfterTbd = syncRoundRobinSlotEntry(
    { id: 'slot-entry-7', entryName: 'TBD' },
    rrMatch.participantAEntryIds ?? [],
    rrMatch.participantAName ?? 'TBD',
  );
  assert(
    syncedAfterTbd.entryName === 'TBD' && syncedAfterTbd.playerId === null,
    'Clearing a round-robin side must revert its slot entry to TBD.',
  );

  return {
    reselected: 'Bella',
    tbdReset: match.participantAName,
    rrSlotEntryPreserved: rrMatch.participantAEntryId,
  };
}

function verifyRoundRobinPlayersPerGroupFlow() {
  // New creation-flow path: empty seeds + explicit per-group size. The plan
  // must create groupCount groups, each with exactly playersPerGroup TBD
  // placeholder slots, and a full all-against-all schedule per group.
  const emptyPlan = buildRoundRobinPlan([], 2, 'BEST_OF_3', 'SINGLES', 3);
  assert(emptyPlan.groupNames.length === 2, 'Two configured groups should be created.');
  assert(
    emptyPlan.playersPerGroup === 3,
    'The configured players-per-group value should be returned on the plan.',
  );
  assert(emptyPlan.entries.length === 6, 'Two groups of three should create six slots.');
  assert(
    emptyPlan.entries.every((entry) => entry.entryName === 'TBD' && !entry.isBye),
    'Empty slots should be TBD placeholder entries.',
  );
  const perGroupCount = (groupName: string) =>
    emptyPlan.entries.filter((entry) => entry.groupName === groupName).length;
  assert(
    perGroupCount('A') === 3 && perGroupCount('B') === 3,
    'Each group should receive exactly its configured number of slots.',
  );
  assert(
    emptyPlan.matches.length === 6,
    'Two groups of three should generate 2 x C(3,2) = 6 matches.',
  );
  for (const groupName of emptyPlan.groupNames) {
    const groupMatches = emptyPlan.matches.filter((match) => match.groupName === groupName);
    const groupSeeds = emptyPlan.entries
      .filter((entry) => entry.groupName === groupName)
      .map((entry) => entry.seed);
    assert(
      groupMatches.length === 3,
      `Group ${groupName} should contain three all-against-all matches.`,
    );
    // Seeds are global across the plan, so the pair coverage is asserted
    // against the group's own seed set rather than absolute numbers.
    const expectedPairs = new Set(
      groupSeeds.flatMap((seedA, indexA) =>
        groupSeeds
          .slice(indexA + 1)
          .map((seedB) => [Math.min(seedA, seedB), Math.max(seedA, seedB)].join('-')),
      ),
    );
    const actualPairs = new Set(
      groupMatches.map((match) =>
        [...(match.participantASeeds ?? []), ...(match.participantBSeeds ?? [])]
          .sort((a, b) => a - b)
          .join('-'),
      ),
    );
    assert(
      actualPairs.size === expectedPairs.size &&
        [...expectedPairs].every((pair) => actualPairs.has(pair)),
      `Group ${groupName} should play every pair among its three slots.`,
    );
  }

  // Standings integration: every configured slot (incl. TBD placeholders)
  // yields a row in the group table.
  const mappedEntries = emptyPlan.entries.map((entry, index) => ({
    ...entry,
    id: `entry-${index + 1}`,
  }));
  const standings = calculateGroupStandings(mappedEntries, []);
  assert(standings.length === 2, 'Standings should render one table per group.');
  assert(
    standings.every((group) => group.standings.length === 3),
    'Each group table should list every configured slot (incl. TBD placeholders).',
  );

  // Mixed path: real participants fill the first slots round-robin, the rest
  // become TBD placeholders within the configured size.
  const participants = [
    { sourceId: 'p1', displayName: 'Alice', participantType: 'PLAYER' as const, playerId: 'p1' },
    { sourceId: 'p2', displayName: 'Bella', participantType: 'PLAYER' as const, playerId: 'p2' },
    { sourceId: 'p3', displayName: 'Cara', participantType: 'PLAYER' as const, playerId: 'p3' },
    { sourceId: 'p4', displayName: 'Dora', participantType: 'PLAYER' as const, playerId: 'p4' },
  ];
  const mixedPlan = buildRoundRobinPlan(participants, 2, 'BEST_OF_3', 'SINGLES', 3);
  assert(mixedPlan.entries.length === 6, 'Two groups of three should create six slots.');
  const groupANames = mixedPlan.entries
    .filter((entry) => entry.groupName === 'A')
    .map((entry) => entry.entryName);
  const groupBNames = mixedPlan.entries
    .filter((entry) => entry.groupName === 'B')
    .map((entry) => entry.entryName);
  assert(
    groupANames.includes('Alice') &&
      groupANames.includes('Cara') &&
      groupANames.includes('TBD'),
    'Group A should hold its round-robin share plus a TBD placeholder.',
  );
  assert(
    groupBNames.includes('Bella') &&
      groupBNames.includes('Dora') &&
      groupBNames.includes('TBD'),
    'Group B should hold its round-robin share plus a TBD placeholder.',
  );

  // Legacy path: without the parameter the old behaviour is preserved (no
  // placeholder padding, group count clamped by participants).
  const legacyPlan = buildRoundRobinPlan(participants, 2, 'BEST_OF_3', 'SINGLES');
  assert(
    legacyPlan.playersPerGroup === undefined && legacyPlan.entries.length === 4,
    'Legacy plans should not pad with placeholders when the size is not configured.',
  );
  assert(
    legacyPlan.entries.every((entry) => entry.entryName !== 'TBD'),
    'Legacy plans should only contain real participants.',
  );

  return {
    groups: emptyPlan.groupNames,
    slotsPerGroup: perGroupCount('A'),
    matches: emptyPlan.matches.length,
    mixedGroupA: groupANames.join(', '),
    mixedGroupB: groupBNames.join(', '),
  };
}

type MirroredMatch = {
  id: string;
  groupName: string;
  participantAEntryId: string | null;
  participantBEntryId: string | null;
  participantAEntryIds: string[];
  participantBEntryIds: string[];
  participantAName: string | null;
  participantBName: string | null;
};

// Pure mirror of the App's syncRoundRobinSlotEntry: the slot entry mirrors the
// bound display name (pair joined with " / " for doubles) and a single playerId
// when exactly one player is bound.
function mirrorSyncRoundRobinSlotEntry<
  TEntry extends { id: string; entryName: string; playerId?: string | null; teamId?: string | null },
>(entries: TEntry[], entryId: string, boundIds: string[], boundName: string): TEntry[] {
  const displayName = boundIds.length ? boundName : 'TBD';
  return entries.map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }
    return {
      ...entry,
      entryName: displayName,
      playerId: boundIds.length === 1 ? boundIds[0] : null,
      teamId: null,
    };
  });
}

// Pure mirror of the App's assignRoundRobinSlot: every group match side wired
// to the slot entry is updated with the same player ids and display name.
function mirrorAssignRoundRobinSlot(
  matches: MirroredMatch[],
  entryId: string,
  boundIds: string[],
  boundName: string,
): MirroredMatch[] {
  const nextIds = boundIds.filter(Boolean);
  const displayName = nextIds.length ? boundName : 'TBD';
  return matches.map((match) => {
    if (match.participantAEntryId === entryId) {
      return { ...match, participantAEntryIds: nextIds, participantAName: displayName };
    }
    if (match.participantBEntryId === entryId) {
      return { ...match, participantBEntryIds: nextIds, participantBName: displayName };
    }
    return match;
  });
}

// Pure mirror of the App's getRoundRobinSlotPlayerIds: read the pair back from
// any match wired to the slot, keeping only known player ids.
function mirrorGetSlotPlayerIds(
  matches: MirroredMatch[],
  entryId: string,
  knownPlayerIds: string[],
): string[] {
  const boundMatch = matches.find(
    (match) =>
      match.participantAEntryId === entryId || match.participantBEntryId === entryId,
  );
  const ids = boundMatch
    ? boundMatch.participantAEntryId === entryId
      ? boundMatch.participantAEntryIds
      : boundMatch.participantBEntryIds
    : [];
  return ids.filter((id) => knownPlayerIds.includes(id));
}

function verifyRoundRobinEntryAssignmentFlow() {
  const players = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bella' },
    { id: 'p3', name: 'Cara' },
    { id: 'p4', name: 'Dora' },
  ];
  const knownPlayerIds = players.map((player) => player.id);

  const buildMirror = (groupCount: number, eventType: 'SINGLES' | 'DOUBLES') => {
    const plan = buildRoundRobinPlan([], groupCount, 'BEST_OF_3', eventType, 3);
    const slotEntries = plan.entries.map((entry, index) => ({
      ...entry,
      id: `entry-${index + 1}`,
    }));
    const matches: MirroredMatch[] = plan.matches.map((match, index) => {
      const entryA = slotEntries.find((entry) => entry.seed === match.participantASeeds?.[0]);
      const entryB = slotEntries.find((entry) => entry.seed === match.participantBSeeds?.[0]);
      return {
        id: `match-${index + 1}`,
        groupName: match.groupName ?? 'A',
        participantAEntryId: entryA?.id ?? null,
        participantBEntryId: entryB?.id ?? null,
        participantAEntryIds: [],
        participantBEntryIds: [],
        participantAName: entryA?.entryName ?? null,
        participantBName: entryB?.entryName ?? null,
      };
    });
    return { slotEntries, matches };
  };

  // ── Singles: assign / re-assign / clear a slot, propagate to every match ──
  const singles = buildMirror(2, 'SINGLES');
  const slotA1 = assertDefined(
    singles.slotEntries.find((entry) => entry.groupName === 'A' && entry.slotNumber === 1),
    'Group A slot 1 should exist.',
  );
  const boundMatchesA1 = (current: MirroredMatch[]) =>
    current.filter((match) => match.participantAEntryId === slotA1.id);

  let singlesEntries = singles.slotEntries;
  let singlesMatches = singles.matches;
  const initialWiredCount = boundMatchesA1(singlesMatches).length;
  assert(initialWiredCount === 2, 'Slot 1 should be wired to two group matches.');

  // Assign Alice to the slot.
  singlesMatches = mirrorAssignRoundRobinSlot(singlesMatches, slotA1.id, ['p1'], 'Alice');
  singlesEntries = mirrorSyncRoundRobinSlotEntry(singlesEntries, slotA1.id, ['p1'], 'Alice');
  assert(
    boundMatchesA1(singlesMatches).every(
      (match) =>
        match.participantAEntryIds.length === 1 &&
        match.participantAEntryIds[0] === 'p1' &&
        match.participantAName === 'Alice',
    ),
    'Assigning a singles player should update every match side wired to the slot.',
  );
  assert(
    mirrorGetSlotPlayerIds(singlesMatches, slotA1.id, knownPlayerIds).join(',') === 'p1',
    'The slot should read back the assigned player id.',
  );
  const singlesMatrixA = formatRoundRobinMatrix(singlesEntries, singlesMatches, 'A');
  assert(
    singlesMatrixA.find((item) => item.entry.id === slotA1.id)?.entry.entryName === 'Alice',
    'The matrix header should reflect the assigned player name.',
  );
  const singlesStandings = calculateGroupStandings(singlesEntries, singlesMatches);
  assert(
    singlesStandings[0].standings.find((row) => row.entryId === slotA1.id)?.entryName ===
      'Alice',
    'The standings entry should reflect the assigned player name.',
  );

  // Re-assign (editability): replacing the player replaces, never appends.
  singlesMatches = mirrorAssignRoundRobinSlot(singlesMatches, slotA1.id, ['p3'], 'Cara');
  singlesEntries = mirrorSyncRoundRobinSlotEntry(singlesEntries, slotA1.id, ['p3'], 'Cara');
  assert(
    boundMatchesA1(singlesMatches).every(
      (match) =>
        match.participantAEntryIds.join(',') === 'p3' && match.participantAName === 'Cara',
    ),
    'Re-selecting a player should replace the previous binding on every match side.',
  );

  // Clear back to TBD.
  singlesMatches = mirrorAssignRoundRobinSlot(singlesMatches, slotA1.id, [], 'TBD');
  singlesEntries = mirrorSyncRoundRobinSlotEntry(singlesEntries, slotA1.id, [], 'TBD');
  assert(
    boundMatchesA1(singlesMatches).every(
      (match) => match.participantAEntryIds.length === 0 && match.participantAName === 'TBD',
    ),
    'Clearing a slot should revert every wired match side to TBD.',
  );
  assert(
    singlesEntries.find((entry) => entry.id === slotA1.id)?.entryName === 'TBD',
    'Clearing a slot should revert the slot entry name to TBD.',
  );

  // ── Doubles: a slot holds two independent players end to end ──
  const doubles = buildMirror(2, 'DOUBLES');
  const slotB1 = assertDefined(
    doubles.slotEntries.find((entry) => entry.groupName === 'B' && entry.slotNumber === 1),
    'Group B slot 1 should exist.',
  );
  const boundMatchesB1 = (current: MirroredMatch[]) =>
    current.filter((match) => match.participantBEntryId === slotB1.id);

  let doublesEntries = doubles.slotEntries;
  let doublesMatches = doubles.matches;

  // Bind the pair Alice / Bella.
  doublesMatches = mirrorAssignRoundRobinSlot(
    doublesMatches,
    slotB1.id,
    ['p1', 'p2'],
    'Alice / Bella',
  );
  doublesEntries = mirrorSyncRoundRobinSlotEntry(
    doublesEntries,
    slotB1.id,
    ['p1', 'p2'],
    'Alice / Bella',
  );
  assert(
    boundMatchesB1(doublesMatches).every(
      (match) =>
        match.participantBEntryIds.join(',') === 'p1,p2' &&
        match.participantBName === 'Alice / Bella',
    ),
    'Doubles assignment should propagate both players to every wired match side.',
  );
  const readBackPair = mirrorGetSlotPlayerIds(doublesMatches, slotB1.id, knownPlayerIds);
  assert(
    readBackPair.join(',') === 'p1,p2',
    'Both doubles players should be read back intact (no missing fields).',
  );
  assert(
    boundMatchesB1(doublesMatches).every(
      (match) => match.participantBEntryIds.join(',') === 'p1,p2',
    ),
    'Every match wired to a doubles slot should carry the identical pair.',
  );
  const doublesMatrixB = formatRoundRobinMatrix(doublesEntries, doublesMatches, 'B');
  assert(
    doublesMatrixB.find((item) => item.entry.id === slotB1.id)?.entry.entryName ===
      'Alice / Bella',
    'The doubles matrix header should show the joined pair name.',
  );

  // Replace only the first player of the pair (slot-level editability).
  doublesMatches = mirrorAssignRoundRobinSlot(doublesMatches, slotB1.id, ['p3', 'p2'], 'Cara / Bella');
  doublesEntries = mirrorSyncRoundRobinSlotEntry(doublesEntries, slotB1.id, ['p3', 'p2'], 'Cara / Bella');
  assert(
    boundMatchesB1(doublesMatches).every(
      (match) => match.participantBEntryIds.join(',') === 'p3,p2',
    ),
    'Editing one doubles player should update the pair on every wired match side.',
  );

  // Partially filled pair (only Player 1).
  doublesMatches = mirrorAssignRoundRobinSlot(doublesMatches, slotB1.id, ['p4'], 'Dora');
  assert(
    mirrorGetSlotPlayerIds(doublesMatches, slotB1.id, knownPlayerIds).join(',') === 'p4',
    'A half-filled doubles slot should read back its single player.',
  );

  // Clear the whole pair back to TBD.
  doublesMatches = mirrorAssignRoundRobinSlot(doublesMatches, slotB1.id, [], 'TBD');
  doublesEntries = mirrorSyncRoundRobinSlotEntry(doublesEntries, slotB1.id, [], 'TBD');
  assert(
    boundMatchesB1(doublesMatches).every(
      (match) => match.participantBEntryIds.length === 0 && match.participantBName === 'TBD',
    ),
    'Clearing a doubles pair should revert every wired match side to TBD.',
  );

  return {
    singlesWiredMatches: initialWiredCount,
    singlesReadBack: mirrorGetSlotPlayerIds(singlesMatches, slotA1.id, knownPlayerIds).join(','),
    singlesEntryName: singlesEntries.find((entry) => entry.id === slotA1.id)?.entryName,
    doublesReadBack: mirrorGetSlotPlayerIds(doublesMatches, slotB1.id, knownPlayerIds).join(','),
    doublesEntryName: doublesEntries.find((entry) => entry.id === slotB1.id)?.entryName,
    matrixCellsPerGroup: formatRoundRobinMatrix(singlesEntries, singlesMatches, 'A')[0].cells.length,
  };
}

const result = {
  roundRobin: verifyRoundRobinRealtimeFlow(),
  matchStatusFlow: verifyMatchStatusFlow(),
  teamBattle: verifyMultiTeamBattleFlow(),
  knockoutBye: verifyKnockoutByeFlow(),
  doublesDropdown: verifyDoublesKnockoutDropdownFlow(),
  participantSelect: verifyParticipantSelectEditableTbdFlow(),
  roundRobinPlayersPerGroup: verifyRoundRobinPlayersPerGroupFlow(),
  roundRobinEntryAssignment: verifyRoundRobinEntryAssignmentFlow(),
  checks: 'passed',
};

console.log(JSON.stringify(result, null, 2));
