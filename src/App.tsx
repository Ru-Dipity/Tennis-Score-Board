/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import {
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import './App.css';
import {
  buildKnockoutPlan,
  buildRoundRobinPlan,
  buildScoreSummary,
  buildTeamBattlePlan,
  calculateGroupStandings,
  calculateTeamBattleSummary,
  createEmptyScoreInputs,
  evaluateMatchScore,
  formatRoundRobinMatrix,
  getBestOf,
  shuffleSelectedParticipants,
  type EventType,
  type MatchFormat,
  type ParticipantSeed,
  type TournamentMode,
  type WinnerSide,
} from './lib/tournament';

const client = generateClient<Schema>();

type Player = any;
type Team = any;
type Tournament = any;
type TournamentEntry = any;
type Match = any;
type Gender = 'MALE' | 'FEMALE' | 'MIXED' | 'UNSPECIFIED';

const ADMIN_GROUP = 'admin';

function authModeForAdmin(isAdmin: boolean) {
  return isAdmin ? ({ authMode: 'userPool' as const }) : undefined;
}

function isAmplifyListItem<T>(value: T | null | undefined): value is T {
  return Boolean(value);
}

function getModeLabel(mode: TournamentMode) {
  if (mode === 'TEAM_BATTLE') {
    return 'Team Battle';
  }
  return mode === 'KNOCKOUT' ? 'Knockout' : 'Round Robin';
}

function getEventTypeLabel(eventType: EventType) {
  if (eventType === 'TEAM') {
    return 'Team Event';
  }
  return eventType === 'DOUBLES' ? 'Doubles' : 'Singles';
}

function getMatchFormatLabel(matchFormat: MatchFormat) {
  if (matchFormat === 'BEST_OF_5') {
    return 'Best of 5';
  }
  if (matchFormat === 'BEST_OF_3') {
    return 'Best of 3';
  }
  return 'Single Set';
}

function getScoreList(match: Match, side: WinnerSide) {
  const values =
    side === 'A' ? match.participantAScores ?? [] : match.participantBScores ?? [];
  return values.filter((value: unknown): value is number => typeof value === 'number');
}

function isSideWinner(match: Match, side: WinnerSide) {
  if (match.winnerSide) {
    return match.winnerSide === side;
  }

  if (match.winnerEntryId) {
    const target = side === 'A' ? match.participantAEntryId : match.participantBEntryId;
    return target === match.winnerEntryId;
  }

  return false;
}

function getFinalMatch(tournamentMatches: Match[]) {
  return [...tournamentMatches]
    .filter((match) => match.stage === 'KNOCKOUT')
    .sort((left, right) => {
      const roundDiff = right.roundNumber - left.roundNumber;
      if (roundDiff !== 0) {
        return roundDiff;
      }
      return right.matchNumber - left.matchNumber;
    })[0];
}

function groupKnockoutRounds(tournamentMatches: Match[]) {
  const roundMap = new Map<number, Match[]>();

  tournamentMatches
    .filter((match) => match.stage === 'KNOCKOUT')
    .forEach((match) => {
      const bucket = roundMap.get(match.roundNumber) ?? [];
      bucket.push(match);
      roundMap.set(match.roundNumber, bucket);
    });

  return Array.from(roundMap.entries()).sort(([left], [right]) => left - right);
}

function defaultTeamLabel(index: number) {
  return index < 26 ? `Team ${String.fromCharCode(65 + index)}` : `Team ${index + 1}`;
}

function normalizeTeamLabels(labels: string[], teamCount: number) {
  return Array.from({ length: teamCount }, (_, index) => {
    const provided = labels[index]?.trim();
    return provided || defaultTeamLabel(index);
  });
}

function getParticipantEntryIds(match: Match, side: WinnerSide) {
  const entryIds =
    side === 'A' ? match.participantAEntryIds ?? [] : match.participantBEntryIds ?? [];
  const singleEntryId =
    side === 'A' ? match.participantAEntryId : match.participantBEntryId;

  if (entryIds.length) {
    return entryIds;
  }

  return singleEntryId ? [singleEntryId] : [];
}

function getMatchDisplayScore(match: Match) {
  return (
    buildScoreSummary(match.participantAScores ?? [], match.participantBScores ?? []) ||
    match.score ||
    'Score pending'
  );
}

function groupTeamBattleDuels(tournamentMatches: Match[]) {
  const duelMap = new Map<string, Match[]>();

  tournamentMatches
    .filter((match) => match.stage === 'TEAM_BATTLE')
    .forEach((match) => {
      const duelLabel =
        match.roundLabel ||
        `${match.participantATeamLabel || 'Team A'} vs ${match.participantBTeamLabel || 'Team B'}`;
      const duelMatches = duelMap.get(duelLabel) ?? [];
      duelMatches.push(match);
      duelMap.set(duelLabel, duelMatches);
    });

  return Array.from(duelMap.entries())
    .map(([duelLabel, duelMatches]) => ({
      duelLabel,
      matches: [...duelMatches].sort((left, right) => left.displayOrder - right.displayOrder),
      summary: calculateTeamBattleSummary(duelMatches as any[]),
      displayOrder: Math.min(...duelMatches.map((match) => match.displayOrder)),
    }))
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authView, setAuthView] = useState<'visitor' | 'admin'>('visitor');
  const [adminLogin, setAdminLogin] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');

  const [playerForm, setPlayerForm] = useState({
    name: '',
    gender: 'UNSPECIFIED' as Gender,
  });
  const [teamForm, setTeamForm] = useState({
    name: '',
    playerOneId: '',
    playerTwoId: '',
  });
  const [tournamentForm, setTournamentForm] = useState({
    name: '',
    mode: 'KNOCKOUT' as TournamentMode,
    eventType: 'SINGLES' as EventType,
    matchFormat: 'BEST_OF_3' as MatchFormat,
    selectedParticipantIds: [] as string[],
    groupCount: 2,
    qualifyPerGroup: 2,
    customRoundLabels: '',
    teamCount: 2,
    teamSize: 4,
    teamLabels: ['Team A', 'Team B'],
  });
  const [matchForm, setMatchForm] = useState({
    matchId: '',
    participantAScores: createEmptyScoreInputs('BEST_OF_3'),
    participantBScores: createEmptyScoreInputs('BEST_OF_3'),
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const subscriptions = [
      client.models.Player.observeQuery({ authMode: 'apiKey' }).subscribe({
        next: ({ items }) => setPlayers(items.filter(isAmplifyListItem)),
      }),
      client.models.Team.observeQuery({ authMode: 'apiKey' }).subscribe({
        next: ({ items }) => setTeams(items.filter(isAmplifyListItem)),
      }),
      client.models.Tournament.observeQuery({ authMode: 'apiKey' }).subscribe({
        next: ({ items }) => setTournaments(items.filter(isAmplifyListItem)),
      }),
      client.models.TournamentEntry
        .observeQuery({ authMode: 'apiKey' })
        .subscribe({
          next: ({ items }) => setEntries(items.filter(isAmplifyListItem)),
        }),
      client.models.Match.observeQuery({ authMode: 'apiKey' }).subscribe({
        next: ({ items }) => setMatches(items.filter(isAmplifyListItem)),
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    };
  }, []);

  useEffect(() => {
    void checkAdminSession();
  }, []);

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const teamMap = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );

  const availableParticipantOptions = useMemo(() => {
    if (tournamentForm.eventType === 'DOUBLES') {
      return teams;
    }
    return players.filter((player) => player.isActive);
  }, [players, teams, tournamentForm.eventType]);

  const selectedParticipants = useMemo(
    () =>
      tournamentForm.selectedParticipantIds
        .map((id, index) => {
          const entity =
            tournamentForm.eventType === 'DOUBLES' ? teamMap.get(id) : playerMap.get(id);
          if (!entity) {
            return null;
          }

          return {
            id,
            name: entity.name,
            order: index + 1,
          };
        })
        .filter(isAmplifyListItem),
    [playerMap, teamMap, tournamentForm.eventType, tournamentForm.selectedParticipantIds],
  );

  const selectedOrderMap = useMemo(
    () => new Map(selectedParticipants.map((participant) => [participant.id, participant.order])),
    [selectedParticipants],
  );

  const teamBattlePreview = useMemo(() => {
    if (tournamentForm.mode !== 'TEAM_BATTLE' && tournamentForm.eventType !== 'TEAM') {
      return [];
    }

    const labels = normalizeTeamLabels(tournamentForm.teamLabels, tournamentForm.teamCount);
    return labels.map((label, teamIndex) => ({
      label,
      members: selectedParticipants.slice(
        teamIndex * tournamentForm.teamSize,
        (teamIndex + 1) * tournamentForm.teamSize,
      ),
    }));
  }, [
    selectedParticipants,
    tournamentForm.eventType,
    tournamentForm.mode,
    tournamentForm.teamCount,
    tournamentForm.teamLabels,
    tournamentForm.teamSize,
  ]);

  const activeTournaments = useMemo(
    () =>
      [...tournaments]
        .filter((item) => item.status !== 'DRAFT')
        .sort((left, right) => left.name.localeCompare(right.name, 'en')),
    [tournaments],
  );

  const tournamentCards = useMemo(
    () =>
      activeTournaments.map((tournament) => {
        const tournamentEntries = entries
          .filter((entry) => entry.tournamentId === tournament.id)
          .sort((left, right) => (left.seed ?? 0) - (right.seed ?? 0));
        const tournamentMatches = matches
          .filter((match) => match.tournamentId === tournament.id)
          .sort((left, right) => left.displayOrder - right.displayOrder);

        return {
          tournament,
          entries: tournamentEntries,
          matches: tournamentMatches,
          standings:
            tournament.mode === 'ROUND_ROBIN'
              ? calculateGroupStandings(tournamentEntries as any[], tournamentMatches as any[])
              : [],
          teamSummary:
            tournament.mode === 'TEAM_BATTLE'
              ? calculateTeamBattleSummary(tournamentMatches as any[])
              : null,
          teamDuels:
            tournament.mode === 'TEAM_BATTLE'
              ? groupTeamBattleDuels(tournamentMatches)
              : [],
        };
      }),
    [activeTournaments, entries, matches],
  );

  const manageableTournaments = useMemo(
    () =>
      [...tournaments].sort((left, right) =>
        left.name.localeCompare(right.name, 'en'),
      ),
    [tournaments],
  );

  const manageablePlayers = useMemo(
    () =>
      [...players]
        .filter((player) => player.isActive)
        .sort((left, right) => left.name.localeCompare(right.name, 'en')),
    [players],
  );

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === matchForm.matchId),
    [matchForm.matchId, matches],
  );

  const selectedMatchTournament = useMemo(
    () =>
      selectedMatch
        ? tournaments.find((tournament) => tournament.id === selectedMatch.tournamentId)
        : null,
    [selectedMatch, tournaments],
  );

  const selectedMatchFormat = (selectedMatch?.matchFormat ||
    selectedMatchTournament?.matchFormat ||
    'BEST_OF_3') as MatchFormat;

  const adminScorableMatches = useMemo(
    () =>
      [...matches]
        .filter((match) => match.participantAName && match.participantBName)
        .sort((left, right) => left.displayOrder - right.displayOrder),
    [matches],
  );

  function upsertLocalItem<T extends { id: string }>(items: T[], item: T) {
    const index = items.findIndex((current) => current.id === item.id);
    if (index === -1) {
      return [...items, item];
    }

    const nextItems = [...items];
    nextItems[index] = { ...nextItems[index], ...item };
    return nextItems;
  }

  function removeLocalItem<T extends { id: string }>(items: T[], id: string) {
    return items.filter((item) => item.id !== id);
  }

  async function checkAdminSession() {
    try {
      await getCurrentUser();
      const session = await fetchAuthSession();
      const groups =
        (session.tokens?.idToken?.payload['cognito:groups'] as string[] | undefined) ??
        [];
      setIsAdmin(groups.includes(ADMIN_GROUP));
      setAuthError(groups.includes(ADMIN_GROUP) ? '' : 'The current account is not in the admin group.');
    } catch {
      setIsAdmin(false);
    } finally {
      setAuthChecked(true);
    }
  }

  async function handleAdminSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    try {
      await signIn({
        username: adminLogin.email.trim(),
        password: adminLogin.password,
      });
      await checkAdminSession();
      setAdminLogin({ email: '', password: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign in.';
      setAuthError(message);
    }
  }

  async function handleSignOut() {
    await signOut();
    setIsAdmin(false);
    setAuthView('visitor');
  }

  function updateTournamentMode(nextEventType: EventType) {
    setTournamentForm((current) => ({
      ...current,
      eventType: nextEventType,
      mode: nextEventType === 'TEAM' ? 'TEAM_BATTLE' : current.mode === 'TEAM_BATTLE' ? 'KNOCKOUT' : current.mode,
      teamLabels: normalizeTeamLabels(current.teamLabels, current.teamCount),
      selectedParticipantIds: [],
    }));
  }

  function updateTeamCount(teamCount: number) {
    setTournamentForm((current) => ({
      ...current,
      teamCount,
      teamLabels: normalizeTeamLabels(current.teamLabels, teamCount),
      selectedParticipantIds: [],
    }));
  }

  function updateTeamLabel(index: number, value: string) {
    setTournamentForm((current) => {
      const nextLabels = normalizeTeamLabels(current.teamLabels, current.teamCount);
      nextLabels[index] = value;
      return {
        ...current,
        teamLabels: nextLabels,
      };
    });
  }

  function toggleParticipantSelection(participantId: string, checked: boolean) {
    setTournamentForm((current) => ({
      ...current,
      selectedParticipantIds: checked
        ? [...current.selectedParticipantIds, participantId]
        : current.selectedParticipantIds.filter((id) => id !== participantId),
    }));
  }

  function handleRandomDraw() {
    setTournamentForm((current) => ({
      ...current,
      selectedParticipantIds: shuffleSelectedParticipants(current.selectedParticipantIds),
    }));
  }

  function unselectParticipant(participantId: string) {
    setTournamentForm((current) => ({
      ...current,
      selectedParticipantIds: current.selectedParticipantIds.filter((id) => id !== participantId),
    }));
  }

  async function createPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Player.create(
        {
          name: playerForm.name.trim(),
          gender: playerForm.gender,
          isActive: true,
        } as any,
        authModeForAdmin(true),
      );
      if (data) {
        setPlayers((current) => upsertLocalItem(current, data as Player));
      }
      setPlayerForm({ name: '', gender: 'UNSPECIFIED' });
      setStatusMessage('Player created successfully.');
    } finally {
      setSaving(false);
    }
  }

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    if (!teamForm.playerOneId || !teamForm.playerTwoId) {
      setStatusMessage('Please select two different players.');
      return;
    }

    if (teamForm.playerOneId === teamForm.playerTwoId) {
      setStatusMessage('A doubles team cannot contain the same player twice.');
      return;
    }

    const playerOne = playerMap.get(teamForm.playerOneId);
    const playerTwo = playerMap.get(teamForm.playerTwoId);
    const defaultName = [playerOne?.name, playerTwo?.name].filter(Boolean).join(' / ');

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Team.create(
        {
          name: teamForm.name.trim() || defaultName,
          playerOneId: teamForm.playerOneId,
          playerTwoId: teamForm.playerTwoId,
        } as any,
        authModeForAdmin(true),
      );
      if (data) {
        setTeams((current) => upsertLocalItem(current, data as Team));
      }
      setTeamForm({ name: '', playerOneId: '', playerTwoId: '' });
      setStatusMessage('Doubles team created successfully.');
    } finally {
      setSaving(false);
    }
  }

  async function createTournament(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    const effectiveMode =
      tournamentForm.eventType === 'TEAM' ? 'TEAM_BATTLE' : tournamentForm.mode;

    if (!tournamentForm.name.trim()) {
      setStatusMessage('Tournament name is required.');
      return;
    }

    if (effectiveMode === 'TEAM_BATTLE') {
      if (tournamentForm.teamSize < 2 || tournamentForm.teamSize % 2 !== 0) {
        setStatusMessage('Team size must be an even number and at least 2.');
        return;
      }
      if (
        tournamentForm.selectedParticipantIds.length !==
        tournamentForm.teamCount * tournamentForm.teamSize
      ) {
        setStatusMessage('Please select exactly teamCount x teamSize players for team battle.');
        return;
      }
    } else if (tournamentForm.selectedParticipantIds.length < 2) {
      setStatusMessage('Please select at least 2 participants.');
      return;
    }

    const participantSeeds: ParticipantSeed[] = tournamentForm.selectedParticipantIds
      .map((id, index) => {
        if (tournamentForm.eventType === 'DOUBLES') {
          const team = teamMap.get(id);
          if (!team) {
            return null;
          }
          return {
            sourceId: team.id,
            displayName: team.name,
            participantType: 'TEAM' as const,
            teamId: team.id,
            selectionOrder: index + 1,
          };
        }

        const player = playerMap.get(id);
        if (!player) {
          return null;
        }
        return {
          sourceId: player.id,
          displayName: player.name,
          participantType: 'PLAYER' as const,
          playerId: player.id,
          selectionOrder: index + 1,
        };
      })
      .filter(isAmplifyListItem);

    if (participantSeeds.length !== tournamentForm.selectedParticipantIds.length) {
      setStatusMessage('Some selected participants could not be resolved. Please reselect them.');
      return;
    }

    const customRoundLabels = tournamentForm.customRoundLabels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);

    setSaving(true);
    setStatusMessage('');

    try {
      const plan =
        effectiveMode === 'TEAM_BATTLE'
          ? buildTeamBattlePlan(
              participantSeeds,
              tournamentForm.teamCount,
              tournamentForm.teamSize,
              normalizeTeamLabels(tournamentForm.teamLabels, tournamentForm.teamCount),
              tournamentForm.matchFormat,
            )
          : effectiveMode === 'KNOCKOUT'
            ? buildKnockoutPlan(
                participantSeeds,
                customRoundLabels,
                tournamentForm.matchFormat,
                tournamentForm.eventType,
              )
            : buildRoundRobinPlan(
                participantSeeds,
                tournamentForm.groupCount,
                tournamentForm.matchFormat,
                tournamentForm.eventType,
              );

      const tournamentPayload: any = {
        name: tournamentForm.name.trim(),
        mode: effectiveMode,
        eventType: tournamentForm.eventType === 'TEAM' ? 'TEAM' : tournamentForm.eventType,
        status: 'LIVE',
        matchFormat: tournamentForm.matchFormat,
        groupCount: effectiveMode === 'ROUND_ROBIN' ? tournamentForm.groupCount : undefined,
        qualifyPerGroup:
          effectiveMode === 'ROUND_ROBIN' ? tournamentForm.qualifyPerGroup : undefined,
        bracketSize: effectiveMode === 'KNOCKOUT' ? (plan as any).bracketSize : undefined,
        roundLabels: effectiveMode === 'KNOCKOUT' ? (plan as any).roundLabels : undefined,
        teamCount: effectiveMode === 'TEAM_BATTLE' ? tournamentForm.teamCount : undefined,
        teamSize: effectiveMode === 'TEAM_BATTLE' ? tournamentForm.teamSize : undefined,
        teamLabels:
          effectiveMode === 'TEAM_BATTLE'
            ? normalizeTeamLabels(tournamentForm.teamLabels, tournamentForm.teamCount)
            : undefined,
        startedAt: new Date().toISOString(),
      };

      const { data: createdTournament } = await client.models.Tournament.create(
        tournamentPayload as any,
        authModeForAdmin(true),
      );

      if (!createdTournament) {
        throw new Error('Tournament creation failed.');
      }

      setTournaments((current) => upsertLocalItem(current, createdTournament as Tournament));

      const entryIdBySeed = new Map<number, string>();

      for (const entry of plan.entries) {
        const payload: any = {
          tournamentId: createdTournament.id,
          participantType: entry.participantType,
          playerId: entry.playerId,
          teamId: entry.teamId,
          entryName: entry.entryName,
          seed: entry.seed,
          groupName: entry.groupName,
          slotNumber: entry.slotNumber,
          isBye: entry.isBye,
          teamOrder: entry.teamOrder,
        };

        const { data: createdEntry } = await client.models.TournamentEntry.create(
          payload as any,
          authModeForAdmin(true),
        );

        if (createdEntry) {
          entryIdBySeed.set(entry.seed, createdEntry.id);
          setEntries((current) => upsertLocalItem(current, createdEntry as TournamentEntry));
        }
      }

      for (const match of plan.matches) {
        const participantAEntryIds = (match.participantASeeds ?? [])
          .map((seed) => entryIdBySeed.get(seed))
          .filter(isAmplifyListItem);
        const participantBEntryIds = (match.participantBSeeds ?? [])
          .map((seed) => entryIdBySeed.get(seed))
          .filter(isAmplifyListItem);
        const winnerEntryIds = (match.winnerSeeds ?? [])
          .map((seed) => entryIdBySeed.get(seed))
          .filter(isAmplifyListItem);

        const payload: any = {
          tournamentId: createdTournament.id,
          stage: match.stage,
          status: match.status,
          matchFormat: match.matchFormat,
          matchCategory: match.matchCategory,
          roundNumber: match.roundNumber,
          roundLabel: match.roundLabel,
          matchNumber: match.matchNumber,
          displayOrder: match.displayOrder,
          groupName: match.groupName,
          participantAEntryId:
            participantAEntryIds.length === 1 ? participantAEntryIds[0] : undefined,
          participantAEntryIds: participantAEntryIds.length ? participantAEntryIds : undefined,
          participantAName: match.participantAName,
          participantATeamLabel: match.participantATeamLabel,
          participantAScores: match.participantAScores,
          participantBEntryId:
            participantBEntryIds.length === 1 ? participantBEntryIds[0] : undefined,
          participantBEntryIds: participantBEntryIds.length ? participantBEntryIds : undefined,
          participantBName: match.participantBName,
          participantBTeamLabel: match.participantBTeamLabel,
          participantBScores: match.participantBScores,
          winnerEntryId: winnerEntryIds.length === 1 ? winnerEntryIds[0] : undefined,
          winnerSide: match.winnerSide,
          score: match.score,
          completedAt: match.status === 'COMPLETED' ? new Date().toISOString() : undefined,
        };

        const { data: createdMatch } = await client.models.Match.create(
          payload as any,
          authModeForAdmin(true),
        );
        if (createdMatch) {
          setMatches((current) => upsertLocalItem(current, createdMatch as Match));
        }
      }

      setTournamentForm({
        name: '',
        mode: 'KNOCKOUT',
        eventType: 'SINGLES',
        matchFormat: 'BEST_OF_3',
        selectedParticipantIds: [],
        groupCount: 2,
        qualifyPerGroup: 2,
        customRoundLabels: '',
        teamCount: 2,
        teamSize: 4,
        teamLabels: ['Team A', 'Team B'],
      });
      setStatusMessage(`Tournament "${createdTournament.name}" was created successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tournament creation failed.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  function hydrateScoreInputs(scoreValues: number[] | undefined, matchFormat: MatchFormat) {
    const inputs = createEmptyScoreInputs(matchFormat);
    (scoreValues ?? []).forEach((value, index) => {
      if (index < inputs.length) {
        inputs[index] = String(value);
      }
    });
    return inputs;
  }

  function handleMatchSelection(matchId: string) {
    const match = matches.find((item) => item.id === matchId);
    const matchFormat = (match?.matchFormat || 'BEST_OF_3') as MatchFormat;

    setMatchForm({
      matchId,
      participantAScores: hydrateScoreInputs(match?.participantAScores, matchFormat),
      participantBScores: hydrateScoreInputs(match?.participantBScores, matchFormat),
    });
  }

  function mergeMatchState(
    currentMatches: Match[],
    matchId: string,
    updatePayload: Record<string, unknown>,
    serverMatch?: Match | null,
  ) {
    const existingMatch = currentMatches.find((match) => match.id === matchId);
    if (!existingMatch) {
      return currentMatches;
    }

    return upsertLocalItem(currentMatches, {
      ...existingMatch,
      ...updatePayload,
      ...(serverMatch ?? {}),
    } as Match);
  }

  async function syncTournamentStatus(tournamentId: string, nextMatches: Match[]) {
    const tournamentMatches = nextMatches.filter((match) => match.tournamentId === tournamentId);
    const allCompleted =
      tournamentMatches.length > 0 &&
      tournamentMatches.every((match) => match.status === 'COMPLETED');

    const updatePayload: any = {
      id: tournamentId,
      status: allCompleted ? 'COMPLETED' : 'LIVE',
      completedAt: allCompleted ? new Date().toISOString() : null,
    };

    const { data } = await client.models.Tournament.update(
      updatePayload,
      authModeForAdmin(true),
    );

    setTournaments((current) =>
      upsertLocalItem(current, {
        ...(current.find((tournament) => tournament.id === tournamentId) ?? {}),
        ...updatePayload,
        ...(data ?? {}),
      } as Tournament),
    );
  }

  async function cascadeKnockoutUpdate(
    sourceMatchId: string,
    winner: { winnerEntryIds?: string[]; winnerName?: string } = {},
    localMatches: Match[] = matches,
  ) {
    const currentMatch = localMatches.find((match) => match.id === sourceMatchId);
    if (!currentMatch) {
      return localMatches;
    }

    const nextMatch = localMatches.find(
      (match) =>
        match.tournamentId === currentMatch.tournamentId &&
        match.stage === 'KNOCKOUT' &&
        match.roundNumber === currentMatch.roundNumber + 1 &&
        match.matchNumber === Math.ceil(currentMatch.matchNumber / 2),
    );

    if (!nextMatch) {
      return localMatches;
    }

    const isLeftBracket = currentMatch.matchNumber % 2 === 1;
    const participantAEntryIds = isLeftBracket
      ? winner.winnerEntryIds ?? []
      : getParticipantEntryIds(nextMatch, 'A');
    const participantBEntryIds = isLeftBracket
      ? getParticipantEntryIds(nextMatch, 'B')
      : winner.winnerEntryIds ?? [];

    const updatePayload: any = {
      id: nextMatch.id,
      participantAEntryIds: participantAEntryIds.length ? participantAEntryIds : null,
      participantAEntryId: participantAEntryIds.length === 1 ? participantAEntryIds[0] : null,
      participantAName: isLeftBracket ? winner.winnerName ?? null : nextMatch.participantAName,
      participantBEntryIds: participantBEntryIds.length ? participantBEntryIds : null,
      participantBEntryId: participantBEntryIds.length === 1 ? participantBEntryIds[0] : null,
      participantBName: isLeftBracket ? nextMatch.participantBName : winner.winnerName ?? null,
      status:
        participantAEntryIds.length && participantBEntryIds.length ? 'IN_PROGRESS' : 'PENDING',
      winnerEntryId: null,
      winnerSide: null,
      participantAScores: null,
      participantBScores: null,
      score: null,
      completedAt: null,
    };

    const { data } = await client.models.Match.update(updatePayload as any, authModeForAdmin(true));
    const nextLocalMatches = mergeMatchState(
      localMatches,
      nextMatch.id,
      updatePayload,
      data as Match | null,
    );
    return cascadeKnockoutUpdate(nextMatch.id, {}, nextLocalMatches);
  }

  async function recordMatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || !selectedMatch) {
      return;
    }

    const evaluated = evaluateMatchScore(
      matchForm.participantAScores,
      matchForm.participantBScores,
      selectedMatchFormat,
    );

    if (!evaluated) {
      setStatusMessage('Please enter a valid score line based on the selected match format.');
      return;
    }

    const winnerEntryId =
      evaluated.winner === 'A'
        ? selectedMatch.participantAEntryId ?? null
        : selectedMatch.participantBEntryId ?? null;
    const winnerEntryIds = getParticipantEntryIds(selectedMatch, evaluated.winner);
    const winnerName =
      evaluated.winner === 'A'
        ? selectedMatch.participantAName
        : selectedMatch.participantBName;
    const updatePayload: any = {
      id: selectedMatch.id,
      participantAScores: evaluated.participantAScores,
      participantBScores: evaluated.participantBScores,
      winnerEntryId,
      winnerSide: evaluated.winner,
      score: evaluated.summary,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    };

    setSaving(true);
    setStatusMessage('');

    try {
      const { data } = await client.models.Match.update(
        updatePayload as any,
        authModeForAdmin(true),
      );
      let nextMatches = mergeMatchState(
        matches,
        selectedMatch.id,
        updatePayload,
        data as Match | null,
      );
      setMatches(nextMatches);

      if (selectedMatch.stage === 'KNOCKOUT') {
        nextMatches = await cascadeKnockoutUpdate(
          selectedMatch.id,
          {
          winnerEntryIds,
          winnerName,
          },
          nextMatches,
        );
        setMatches(nextMatches);
      }

      await syncTournamentStatus(selectedMatch.tournamentId, nextMatches);

      setMatchForm({
        matchId: selectedMatch.id,
        participantAScores: hydrateScoreInputs(evaluated.participantAScores, selectedMatchFormat),
        participantBScores: hydrateScoreInputs(evaluated.participantBScores, selectedMatchFormat),
      });
      setStatusMessage('Match score saved successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save the match score.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function clearMatchScore() {
    if (!isAdmin || !selectedMatch) {
      return;
    }

    const updatePayload: any = {
      id: selectedMatch.id,
      participantAScores: null,
      participantBScores: null,
      winnerEntryId: null,
      winnerSide: null,
      score: null,
      status:
        selectedMatch.participantAName && selectedMatch.participantBName
          ? 'IN_PROGRESS'
          : 'PENDING',
      completedAt: null,
    };

    setSaving(true);
    setStatusMessage('');

    try {
      const { data } = await client.models.Match.update(
        updatePayload as any,
        authModeForAdmin(true),
      );
      let nextMatches = mergeMatchState(
        matches,
        selectedMatch.id,
        updatePayload,
        data as Match | null,
      );
      setMatches(nextMatches);

      if (selectedMatch.stage === 'KNOCKOUT') {
        nextMatches = await cascadeKnockoutUpdate(selectedMatch.id, {}, nextMatches);
        setMatches(nextMatches);
      }

      await syncTournamentStatus(selectedMatch.tournamentId, nextMatches);
      setMatchForm({
        matchId: selectedMatch.id,
        participantAScores: createEmptyScoreInputs(selectedMatchFormat),
        participantBScores: createEmptyScoreInputs(selectedMatchFormat),
      });
      setStatusMessage('Match score removed. You can submit a new score now.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear the match score.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTournament(tournamentId: string) {
    if (!isAdmin) {
      return;
    }

    const shouldResetSelectedMatch = matches.some(
      (match) => match.id === matchForm.matchId && match.tournamentId === tournamentId,
    );

    setSaving(true);
    setStatusMessage('');
    try {
      const tournamentMatches = matches.filter((match) => match.tournamentId === tournamentId);
      const tournamentEntries = entries.filter((entry) => entry.tournamentId === tournamentId);

      for (const match of tournamentMatches) {
        await client.models.Match.delete({ id: match.id } as any, authModeForAdmin(true));
      }

      for (const entry of tournamentEntries) {
        await client.models.TournamentEntry.delete(
          { id: entry.id } as any,
          authModeForAdmin(true),
        );
      }

      await client.models.Tournament.delete(
        { id: tournamentId } as any,
        authModeForAdmin(true),
      );
      setMatches((current) =>
        current.filter((match) => match.tournamentId !== tournamentId),
      );
      setEntries((current) =>
        current.filter((entry) => entry.tournamentId !== tournamentId),
      );
      setTournaments((current) => removeLocalItem(current, tournamentId));
      if (shouldResetSelectedMatch) {
        setMatchForm({
          matchId: '',
          participantAScores: createEmptyScoreInputs('BEST_OF_3'),
          participantBScores: createEmptyScoreInputs('BEST_OF_3'),
        });
      }
      setStatusMessage('Tournament deleted.');
    } finally {
      setSaving(false);
    }
  }

  async function deletePlayer(playerId: string) {
    if (!isAdmin) {
      return;
    }

    const player = players.find((item) => item.id === playerId);
    const linkedTeams = teams.filter(
      (team) => team.playerOneId === playerId || team.playerTwoId === playerId,
    );
    const linkedEntries = entries.filter((entry) => entry.playerId === playerId);

    if (linkedTeams.length || linkedEntries.length) {
      setSaving(true);
      setStatusMessage('');
      try {
        const { data } = await client.models.Player.update(
          {
            id: playerId,
            isActive: false,
          } as any,
          authModeForAdmin(true),
        );
        setPlayers((current) =>
          upsertLocalItem(
            current,
            ({
              ...(current.find((item) => item.id === playerId) ?? {}),
              id: playerId,
              isActive: false,
              ...(data ?? {}),
            } as Player),
          ),
        );
        setTeamForm((current) => ({
          ...current,
          playerOneId: current.playerOneId === playerId ? '' : current.playerOneId,
          playerTwoId: current.playerTwoId === playerId ? '' : current.playerTwoId,
        }));
        setTournamentForm((current) => ({
          ...current,
          selectedParticipantIds: current.selectedParticipantIds.filter((id) => id !== playerId),
        }));
        setStatusMessage(
          `Player "${player?.name ?? 'Unknown'}" is already used in a team or tournament, so it was archived and removed from active lists instead of being hard-deleted.`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to archive the player.';
        setStatusMessage(message);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      await client.models.Player.delete({ id: playerId } as any, authModeForAdmin(true));
      setPlayers((current) => removeLocalItem(current, playerId));
      setTeamForm((current) => ({
        ...current,
        playerOneId: current.playerOneId === playerId ? '' : current.playerOneId,
        playerTwoId: current.playerTwoId === playerId ? '' : current.playerTwoId,
      }));
      setTournamentForm((current) => ({
        ...current,
        selectedParticipantIds: current.selectedParticipantIds.filter((id) => id !== playerId),
      }));
      setStatusMessage(`Player "${player?.name ?? 'Unknown'}" deleted successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete player.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(teamId: string) {
    if (!isAdmin) {
      return;
    }

    const team = teams.find((item) => item.id === teamId);
    const linkedEntries = entries.filter((entry) => entry.teamId === teamId);
    const isSelected = tournamentForm.selectedParticipantIds.includes(teamId);

    if (isSelected) {
      unselectParticipant(teamId);
      setStatusMessage(`Team "${team?.name ?? 'Unknown'}" removed from the current selection.`);
      return;
    }

    // Only consider entries that belong to tournaments that still exist.
    // Entries from deleted tournaments may linger in local state due to
    // race conditions between observeQuery subscriptions and setEntries.
    const activeLinkedEntries = linkedEntries.filter((entry) =>
      tournaments.some((t) => t.id === entry.tournamentId),
    );

    if (activeLinkedEntries.length) {
      setStatusMessage(
        `Cannot delete ${team?.name ?? 'this team'} because it is already used in a tournament entry.`,
      );
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      await client.models.Team.delete({ id: teamId } as any, authModeForAdmin(true));
      setTeams((current) => removeLocalItem(current, teamId));
      setStatusMessage(`Team "${team?.name ?? 'Unknown'}" deleted successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete team.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  function getTeamBattleEntriesForSide(match: Match, side: WinnerSide) {
    const teamLabel = side === 'A' ? match.participantATeamLabel : match.participantBTeamLabel;
    return entries
      .filter((entry) => entry.tournamentId === match.tournamentId && entry.groupName === teamLabel)
      .sort((left, right) => {
        const orderDiff = (left.teamOrder ?? 0) - (right.teamOrder ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return (left.seed ?? 0) - (right.seed ?? 0);
      });
  }

  function formatTeamBattleParticipantName(entryIds: string[], matchCategory: string) {
    const resolvedEntries = entryIds
      .map((entryId) => entryMap.get(entryId))
      .filter(isAmplifyListItem);

    if (!resolvedEntries.length) {
      return null;
    }

    if (matchCategory === 'TEAM_DOUBLES') {
      return resolvedEntries.map((entry) => entry.entryName).join(' / ');
    }

    const [entry] = resolvedEntries;
    return `${entry.entryName} (#${entry.teamOrder ?? entry.slotNumber ?? 1})`;
  }

  async function updateTeamBattleLineup(
    match: Match,
    side: WinnerSide,
    nextEntryIds: string[],
  ) {
    if (!isAdmin) {
      return;
    }

    const uniqueEntryIds = Array.from(new Set(nextEntryIds.filter(Boolean)));
    const requiredCount = match.matchCategory === 'TEAM_DOUBLES' ? 2 : 1;

    if (uniqueEntryIds.length !== requiredCount) {
      return;
    }

    const participantName = formatTeamBattleParticipantName(uniqueEntryIds, match.matchCategory);
    if (!participantName) {
      return;
    }

    const prefix = side === 'A' ? 'participantA' : 'participantB';
    const updatePayload: any = {
      id: match.id,
      [`${prefix}EntryIds`]: uniqueEntryIds,
      [`${prefix}EntryId`]: uniqueEntryIds.length === 1 ? uniqueEntryIds[0] : null,
      [`${prefix}Name`]: participantName,
    };

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Match.update(
        updatePayload as any,
        authModeForAdmin(true),
      );
      setMatches((current) =>
        mergeMatchState(current, match.id, updatePayload, data as Match | null),
      );
      setStatusMessage('Team battle lineup updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update lineup.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  function renderParticipantRow(
    match: Match,
    side: WinnerSide,
    finalMatch: Match | undefined,
  ) {
    const isWinner = isSideWinner(match, side);
    const isFinal = finalMatch?.id === match.id && match.status === 'COMPLETED';
    const isChampion = isFinal && isWinner;
    const isRunnerUp = isFinal && !isWinner;
    const participantName = side === 'A' ? match.participantAName : match.participantBName;
    const scores = getScoreList(match, side);

    return (
      <div
        className={`slot-row ${isWinner ? 'winner-row' : ''} ${isChampion ? 'champion-row' : ''}`}
      >
        <div className="participant-meta">
          <span className="participant-name">{participantName || 'TBD'}</span>
          <div className="participant-badges">
            {isWinner ? <span className="inline-badge winner-badge">✓ Winner</span> : null}
            {isChampion ? <span className="inline-badge champion-badge">🏆 Champion</span> : null}
            {isRunnerUp ? <span className="inline-badge runnerup-badge">🥈 Runner-up</span> : null}
          </div>
        </div>
        <div className="set-score-strip">
          {scores.length ? (
            scores.map((score: number, index: number) => (
              <span className="set-score-cell" key={`${match.id}-${side}-${index}`}>
                {score}
              </span>
            ))
          ) : (
            <span className="set-score-placeholder">{match.score === 'BYE' ? 'BYE' : '—'}</span>
          )}
        </div>
      </div>
    );
  }

  function renderTeamBattleSide(match: Match, side: WinnerSide) {
    const isWinner = isSideWinner(match, side);
    const participantName = side === 'A' ? match.participantAName : match.participantBName;
    const teamLabel = side === 'A' ? match.participantATeamLabel : match.participantBTeamLabel;
    const scores = getScoreList(match, side);
    const isDoubles = match.matchCategory === 'TEAM_DOUBLES';

    // For doubles, split "name1 / name2" into separate <span> elements
    // so CSS .team-submatch-player-name + .team-submatch-player-name can stack them.
    const playerNames: string[] = isDoubles && participantName
      ? participantName.split(' / ').filter(Boolean)
      : participantName
        ? [participantName]
        : ['TBD'];

    return (
      <div
        className={`team-submatch-side team-submatch-side-${side.toLowerCase()} ${isWinner ? 'team-submatch-side-winner' : ''}`}
      >
        <span className="team-submatch-team-label">{teamLabel || 'Team TBD'}</span>
        <div className="team-submatch-player-block">
          {playerNames.map((name, idx) => (
            <span className="team-submatch-player-name" key={`${match.id}-${side}-name-${idx}`}>
              {name}
            </span>
          ))}
          <div className="participant-badges">
            {isWinner ? <span className="inline-badge winner-badge">✓ Winner</span> : null}
          </div>
        </div>
        <div className="set-score-strip">
          {scores.length ? (
            scores.map((score: number, index: number) => (
              <span className="set-score-cell" key={`${match.id}-${side}-team-${index}`}>
                {score}
              </span>
            ))
          ) : (
            <span className="set-score-placeholder">—</span>
          )}
        </div>
      </div>
    );
  }

  function renderTeamBattleMatchCard(match: Match) {
    return (
      <div className="team-submatch-card" key={match.id}>
        <div className="team-submatch-head">
          <strong>{match.matchCategory === 'TEAM_DOUBLES' ? 'Doubles' : 'Singles'}</strong>
          <span>{match.groupName}</span>
        </div>
        <div className="team-submatch-body">
          {renderTeamBattleSide(match, 'A')}
          <div className="team-submatch-scoreboard">
            <span className="team-submatch-format">{getMatchFormatLabel(match.matchFormat)}</span>
            <strong className="team-submatch-score">{getMatchDisplayScore(match)}</strong>
            <span className={`status-pill status-${String(match.status).toLowerCase()}`}>
              {match.status === 'COMPLETED' ? 'Completed' : match.status === 'IN_PROGRESS' ? 'In Progress' : 'Pending'}
            </span>
          </div>
          {renderTeamBattleSide(match, 'B')}
        </div>
      </div>
    );
  }

  function renderTeamBattleLineupSelect(match: Match, side: WinnerSide, slotIndex: number) {
    const teamEntries = getTeamBattleEntriesForSide(match, side);
    const selectedEntryIds = getParticipantEntryIds(match, side);
    const requiredCount = match.matchCategory === 'TEAM_DOUBLES' ? 2 : 1;
    const normalizedSelection = Array.from({ length: requiredCount }, (_, index) =>
      selectedEntryIds[index] ?? '',
    );
    const currentValue = normalizedSelection[slotIndex] ?? '';
    const reservedIds = normalizedSelection.filter(
      (entryId, index) => entryId && index !== slotIndex,
    );

    return (
      <label className="team-lineup-select" key={`${match.id}-${side}-${slotIndex}`}>
        <span>
          {match.matchCategory === 'TEAM_DOUBLES'
            ? `Player ${slotIndex + 1}`
            : 'Assigned player'}
        </span>
        <select
          value={currentValue}
          disabled={saving || match.status === 'COMPLETED'}
          onChange={(event) => {
            const nextEntryIds = [...normalizedSelection];
            nextEntryIds[slotIndex] = event.target.value;
            void updateTeamBattleLineup(match, side, nextEntryIds);
          }}
        >
          <option value="">Select player</option>
          {teamEntries
            .filter((entry) => entry.id === currentValue || !reservedIds.includes(entry.id))
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                #{entry.teamOrder ?? entry.slotNumber ?? 1} {entry.entryName}
              </option>
            ))}
        </select>
      </label>
    );
  }

  function renderTeamBattleLineupEditor(match: Match) {
    if (match.stage !== 'TEAM_BATTLE') {
      return null;
    }

    const slotCount = match.matchCategory === 'TEAM_DOUBLES' ? 2 : 1;

    return (
      <div className="team-lineup-editor">
        <div className="team-lineup-editor-head">
          <strong>Adjust lineup before scoring</strong>
          <span>
            {match.status === 'COMPLETED'
              ? 'Clear the score first to change this completed lineup.'
              : 'Selections update the match card immediately.'}
          </span>
        </div>
        <div className="team-lineup-grid">
          {(['A', 'B'] as WinnerSide[]).map((side) => (
            <div className="team-lineup-side" key={`${match.id}-${side}`}>
              <strong>
                {side === 'A' ? match.participantATeamLabel || 'Team A' : match.participantBTeamLabel || 'Team B'}
              </strong>
              <div className="team-lineup-selects">
                {Array.from({ length: slotCount }, (_, index) =>
                  renderTeamBattleLineupSelect(match, side, index),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  async function handleParticipantChipRemove(participantId: string) {
    const isSelected = tournamentForm.selectedParticipantIds.includes(participantId);
    if (isSelected) {
      unselectParticipant(participantId);
      setStatusMessage('Selection updated.');
      return;
    }

    if (tournamentForm.eventType === 'DOUBLES') {
      await deleteTeam(participantId);
      return;
    }

    await deletePlayer(participantId);
  }

  return (
    <div className="app-shell">
      <header className="hero-banner">
        <div>
          <p className="eyebrow">Tennis Tournament Control Center</p>
          <h1>Tennis Score Board</h1>
          <p className="hero-copy">
            Visitors can follow live tournaments in real time, while admins can manage players,
            teams, draws, team battles, and multi-set score entry from a single control panel.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>Active tournaments</span>
            <strong>{activeTournaments.length}</strong>
          </div>
          <div className="stat-card">
            <span>Players</span>
            <strong>{players.length}</strong>
          </div>
          <div className="stat-card">
            <span>Matches</span>
            <strong>{matches.length}</strong>
          </div>
        </div>
      </header>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <p className="section-tag">Visitor View</p>
            <h2>Live Tournament Display</h2>
          </div>
          <p className="section-desc">
            All public screens are read-only and refresh automatically through Amplify real-time
            subscriptions.
          </p>
        </div>

        {tournamentCards.length === 0 ? (
          <div className="empty-state">
            No live tournament is available yet. Once an admin creates one, the public board will
            update automatically.
          </div>
        ) : (
          <div className="tournament-grid">
            {tournamentCards.map(({ tournament, entries: tournamentEntries, matches: tournamentMatches, standings, teamSummary, teamDuels }) => {
              const finalMatch = getFinalMatch(tournamentMatches);
              return (
                <article className="tournament-card" key={tournament.id}>
                  <div className="card-head">
                    <div>
                      <p className="meta-line">
                        {getModeLabel(tournament.mode)} · {getEventTypeLabel(tournament.eventType)} ·{' '}
                        {getMatchFormatLabel(tournament.matchFormat)}
                      </p>
                      <h3>{tournament.name}</h3>
                    </div>
                    <span className={`status-pill status-${String(tournament.status).toLowerCase()}`}>
                      {tournament.status === 'COMPLETED' ? 'Completed' : 'Live'}
                    </span>
                  </div>

                  {tournament.mode === 'KNOCKOUT' ? (
                    <div className="bracket-rounds">
                      {groupKnockoutRounds(tournamentMatches).map(([round, roundMatches]) => (
                        <div className="round-column" key={`${tournament.id}-${round}`}>
                          <h4>{roundMatches[0]?.roundLabel ?? `Round ${round}`}</h4>
                          {roundMatches.map((match) => (
                            <div className="match-box" key={match.id}>
                              {renderParticipantRow(match, 'A', finalMatch)}
                              {renderParticipantRow(match, 'B', finalMatch)}
                              <div className="match-foot">
                                <span>{match.score === 'BYE' ? 'Automatic advance by BYE' : match.score || 'Score pending'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {tournament.mode === 'ROUND_ROBIN' ? (
                    <div className="group-layout">
                      {standings.map((group) => (
                        <section className="group-card" key={`${tournament.id}-${group.groupName}`}>
                          <div className="group-head">
                            <h4>Group {group.groupName}</h4>
                            <span>Top {tournament.qualifyPerGroup ?? 2} advance</span>
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Entry</th>
                                  <th>Points</th>
                                  <th>Wins</th>
                                  <th>Games Won</th>
                                  <th>Net Games</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.standings.map((row, index) => (
                                  <tr
                                    key={row.entryId}
                                    className={index < (tournament.qualifyPerGroup ?? 2) ? 'qualified' : ''}
                                  >
                                    <td>{row.entryName}</td>
                                    <td>{row.points}</td>
                                    <td>{row.wins}</td>
                                    <td>{row.gamesWon}</td>
                                    <td>{row.gamesWon - row.gamesLost}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="table-wrap">
                            <table className="matrix-table">
                              <thead>
                                <tr>
                                  <th>Round Robin Matrix</th>
                                  {formatRoundRobinMatrix(
                                    tournamentEntries as any[],
                                    tournamentMatches as any[],
                                    group.groupName,
                                  ).map((item) => (
                                    <th key={`${group.groupName}-${item.entry.id}`}>{item.entry.entryName}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {formatRoundRobinMatrix(
                                  tournamentEntries as any[],
                                  tournamentMatches as any[],
                                  group.groupName,
                                ).map((row) => (
                                  <tr key={row.entry.id}>
                                    <td>{row.entry.entryName}</td>
                                    {row.cells.map((cell, index) => (
                                      <td key={`${row.entry.id}-${index}`}>{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}

                  {tournament.mode === 'TEAM_BATTLE' && teamSummary ? (
                    <div className="team-battle-layout">
                      <div className="team-battle-summary">
                        {teamSummary.teams.map((team) => (
                          <div
                            className={`team-summary-card ${teamSummary.winner?.teamLabel === team.teamLabel ? 'team-summary-winner' : ''}`}
                            key={`${tournament.id}-${team.teamLabel}`}
                          >
                            <h4>{team.teamLabel}</h4>
                            <div className="team-summary-stats">
                              <span>Match wins: <strong>{team.matchWins}</strong></span>
                              <span>Games won: <strong>{team.gamesWon}</strong></span>
                              <span>Net games: <strong>{team.gamesWon - team.gamesLost}</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="team-duel-grid">
                        {teamDuels.map((duel) => (
                          <section className="team-duel-card" key={`${tournament.id}-${duel.duelLabel}`}>
                            <div className="team-submatch-head">
                              <strong>{duel.duelLabel}</strong>
                              <span>
                                {duel.summary.teams
                                  .map((team) => `${team.teamLabel}: ${team.matchWins}`)
                                  .join(' · ')}
                              </span>
                            </div>

                            <div className="team-duel-summary">
                              {duel.summary.teams.map((team) => (
                                <div
                                  className={`team-summary-card ${duel.summary.winner?.teamLabel === team.teamLabel ? 'team-summary-winner' : ''}`}
                                  key={`${duel.duelLabel}-${team.teamLabel}`}
                                >
                                  <h4>{team.teamLabel}</h4>
                                  <div className="team-summary-stats">
                                    <span>Match wins: <strong>{team.matchWins}</strong></span>
                                    <span>Games won: <strong>{team.gamesWon}</strong></span>
                                    <span>Net games: <strong>{team.gamesWon - team.gamesLost}</strong></span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="team-submatch-list">
                              {duel.matches.map((match) => renderTeamBattleMatchCard(match))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  ) : null}

                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <p className="section-tag">Admin Console</p>
            <h2>Admin Management</h2>
          </div>
          <p className="section-desc">
            The admin console supports seeded manual selection, random draw, multi-set score entry,
            knockout propagation, and team battle scheduling.
          </p>
        </div>

        {!authChecked ? (
          <div className="empty-state">Checking admin session...</div>
        ) : !isAdmin ? (
          <div className="admin-auth-layout">
            <div className="auth-switch">
              <button
                className={authView === 'visitor' ? 'active' : ''}
                onClick={() => setAuthView('visitor')}
                type="button"
              >
                Read-only mode
              </button>
              <button
                className={authView === 'admin' ? 'active' : ''}
                onClick={() => setAuthView('admin')}
                type="button"
              >
                Admin sign in
              </button>
            </div>

            {authView === 'visitor' ? (
              <div className="empty-state">
                The public board stays accessible without sign-in. Use an account inside the
                Cognito <code>admin</code> group to unlock management features.
              </div>
            ) : (
              <div className="admin-login-grid">
                <form className="panel-form" onSubmit={handleAdminSignIn}>
                  <h3>Admin Sign In</h3>
                  <label>
                    Email
                    <input
                      type="email"
                      value={adminLogin.email}
                      onChange={(event) =>
                        setAdminLogin((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={adminLogin.password}
                      onChange={(event) =>
                        setAdminLogin((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <button className="primary-button" type="submit">
                    Sign in
                  </button>
                  {authError ? <p className="error-text">{authError}</p> : null}
                </form>

                <div className="panel-info">
                  <h3>Admin setup notes</h3>
                  <ul>
                    <li>Create the admin account in Amplify Auth / Cognito.</li>
                    <li>Add that account into the <code>admin</code> user group.</li>
                    <li>After sign-in, write access becomes available automatically.</li>
                  </ul>
                  <div className="authenticator-preview">
                    <Authenticator />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="admin-console">
            <div className="admin-topbar">
              <p>Signed in as admin.</p>
              <button className="secondary-button" onClick={handleSignOut} type="button">
                Sign out
              </button>
            </div>

            {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

            <div className="admin-grid">
              <form className="panel-form" onSubmit={createPlayer}>
                <h3>Add Player</h3>
                <label>
                  Name
                  <input
                    type="text"
                    value={playerForm.name}
                    onChange={(event) =>
                      setPlayerForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Gender
                  <select
                    value={playerForm.gender}
                    onChange={(event) =>
                      setPlayerForm((current) => ({
                        ...current,
                        gender: event.target.value as Gender,
                      }))
                    }
                  >
                    <option value="UNSPECIFIED">Unspecified</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="MIXED">Mixed</option>
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={saving}>
                  Save player
                </button>
              </form>

              <form className="panel-form" onSubmit={createTeam}>
                <h3>Create Doubles Team</h3>
                <label>
                  Team name
                  <input
                    type="text"
                    value={teamForm.name}
                    onChange={(event) =>
                      setTeamForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Leave empty to auto-generate"
                  />
                </label>
                <label>
                  Player A
                  <select
                    value={teamForm.playerOneId}
                    onChange={(event) =>
                      setTeamForm((current) => ({ ...current, playerOneId: event.target.value }))
                    }
                    required
                  >
                    <option value="">Select a player</option>
                    {manageablePlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Player B
                  <select
                    value={teamForm.playerTwoId}
                    onChange={(event) =>
                      setTeamForm((current) => ({ ...current, playerTwoId: event.target.value }))
                    }
                    required
                  >
                    <option value="">Select a player</option>
                    {manageablePlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={saving}>
                  Save doubles team
                </button>
              </form>

              <form className="panel-form full-span" onSubmit={createTournament}>
                <h3>Create Tournament</h3>

                <div className="form-grid">
                  <label>
                    Tournament name
                    <input
                      type="text"
                      value={tournamentForm.name}
                      onChange={(event) =>
                        setTournamentForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="2026 Summer Club Cup - Men's Singles"
                      required
                    />
                  </label>
                  <label>
                    Event type
                    <select
                      value={tournamentForm.eventType}
                      onChange={(event) => updateTournamentMode(event.target.value as EventType)}
                    >
                      <option value="SINGLES">Singles</option>
                      <option value="DOUBLES">Doubles</option>
                      <option value="TEAM">Team Battle</option>
                    </select>
                  </label>
                  <label>
                    Match format
                    <select
                      value={tournamentForm.matchFormat}
                      onChange={(event) =>
                        setTournamentForm((current) => ({
                          ...current,
                          matchFormat: event.target.value as MatchFormat,
                        }))
                      }
                    >
                      <option value="SINGLE_SET">Single Set</option>
                      <option value="BEST_OF_3">Best of 3</option>
                      <option value="BEST_OF_5">Best of 5</option>
                    </select>
                  </label>

                  {tournamentForm.eventType !== 'TEAM' ? (
                    <label>
                      Tournament mode
                      <select
                        value={tournamentForm.mode}
                        onChange={(event) =>
                          setTournamentForm((current) => ({
                            ...current,
                            mode: event.target.value as TournamentMode,
                          }))
                        }
                      >
                        <option value="KNOCKOUT">Knockout</option>
                        <option value="ROUND_ROBIN">Round Robin</option>
                      </select>
                    </label>
                  ) : (
                    <>
                      <label>
                        Team count
                        <input
                          type="number"
                          min={2}
                          value={tournamentForm.teamCount}
                          onChange={(event) => updateTeamCount(Number(event.target.value))}
                        />
                      </label>
                      <label>
                        Players per team
                        <input
                          type="number"
                          min={2}
                          step={2}
                          value={tournamentForm.teamSize}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              teamSize: Number(event.target.value),
                              selectedParticipantIds: [],
                            }))
                          }
                        />
                      </label>
                      {normalizeTeamLabels(
                        tournamentForm.teamLabels,
                        tournamentForm.teamCount,
                      ).map((label, index) => (
                        <label key={`team-label-${index}`}>
                          Team {index + 1} label
                          <input
                            type="text"
                            value={label}
                            onChange={(event) => updateTeamLabel(index, event.target.value)}
                          />
                        </label>
                      ))}
                    </>
                  )}

                  {tournamentForm.eventType !== 'TEAM' && tournamentForm.mode === 'ROUND_ROBIN' ? (
                    <>
                      <label>
                        Group count
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={tournamentForm.groupCount}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              groupCount: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Qualifiers per group
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={tournamentForm.qualifyPerGroup}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              qualifyPerGroup: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </>
                  ) : null}

                  {tournamentForm.eventType !== 'TEAM' && tournamentForm.mode === 'KNOCKOUT' ? (
                    <label className="wide-field">
                      Custom round labels
                      <input
                        type="text"
                        value={tournamentForm.customRoundLabels}
                        onChange={(event) =>
                          setTournamentForm((current) => ({
                            ...current,
                            customRoundLabels: event.target.value,
                          }))
                        }
                        placeholder="Qualifier, Quarterfinal, Semifinal, Final"
                      />
                    </label>
                  ) : null}
                </div>

                <fieldset className="participant-picker">
                  <legend>
                    Select{' '}
                    {tournamentForm.eventType === 'DOUBLES'
                      ? 'doubles teams'
                      : tournamentForm.eventType === 'TEAM'
                        ? 'players for team battle'
                        : 'players'}
                  </legend>

                  <div className="participant-picker-toolbar">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleRandomDraw}
                      disabled={tournamentForm.selectedParticipantIds.length < 2}
                    >
                      🎲 Random Draw / Shuffle
                    </button>
                    <span className="picker-hint">
                      Selection order becomes the live seed order shown as #1, #2, #3...
                    </span>
                  </div>

                  <div className="participant-options">
                    {availableParticipantOptions.map((participant) => {
                      const seedOrder = selectedOrderMap.get(participant.id);
                      return (
                        <label
                          key={participant.id}
                          className={`checkbox-chip ${seedOrder ? 'checkbox-chip-active' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(seedOrder)}
                            onChange={(event) =>
                              toggleParticipantSelection(participant.id, event.target.checked)
                            }
                          />
                          <span className="checkbox-chip-label">{participant.name}</span>
                          {seedOrder ? <span className="seed-order-badge">#{seedOrder}</span> : null}
                          <button
                            className="chip-remove-button"
                            type="button"
                            aria-label={
                              seedOrder
                                ? `Remove ${participant.name} from selection`
                                : `Delete ${participant.name}`
                            }
                            title={
                              seedOrder
                                ? 'Remove from current selection'
                                : 'Delete this saved entry'
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleParticipantChipRemove(participant.id);
                            }}
                            disabled={saving}
                          >
                            ×
                          </button>
                        </label>
                      );
                    })}
                  </div>

                  {selectedParticipants.length ? (
                    <div className="selected-order-panel">
                      <strong>Current selection order</strong>
                      <div className="selected-order-chips">
                        {selectedParticipants.map((participant) => (
                          <span className="selected-order-chip" key={participant.id}>
                            <span>
                              #{participant.order} {participant.name}
                            </span>
                            <button
                              className="selected-chip-remove"
                              type="button"
                              aria-label={`Remove ${participant.name} from selection`}
                              onClick={() => unselectParticipant(participant.id)}
                              disabled={saving}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {teamBattlePreview.length ? (
                    <div className="team-preview-grid">
                      {teamBattlePreview.map((team) => (
                        <div className="team-preview-card" key={team.label}>
                          <h4>{team.label}</h4>
                          {team.members.length ? (
                            team.members.map((member, index) => (
                              <div className="team-preview-row" key={`${team.label}-${member.id}`}>
                                <span>#{index + 1}</span>
                                <strong>{member.name}</strong>
                              </div>
                            ))
                          ) : (
                            <p className="team-preview-empty">No players assigned yet.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </fieldset>

                <button className="primary-button" type="submit" disabled={saving}>
                  Create draw and schedule
                </button>
              </form>

              <form className="panel-form" onSubmit={recordMatch}>
                <h3>Record Match Score</h3>
                <label>
                  Select match
                  <select
                    value={matchForm.matchId}
                    onChange={(event) => handleMatchSelection(event.target.value)}
                    required
                  >
                    <option value="">Choose a match</option>
                    {adminScorableMatches.map((match) => (
                      <option key={match.id} value={match.id}>
                        [{match.status === 'COMPLETED' ? 'Completed' : 'Open'}] {match.roundLabel} -{' '}
                        {match.participantAName || 'TBD'} vs {match.participantBName || 'TBD'} ·{' '}
                        {getMatchDisplayScore(match)}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedMatch ? (
                  <div className="match-entry-panel">
                    <div className="match-entry-head">
                      <strong>{selectedMatch.roundLabel}</strong>
                      <span>
                        {getMatchFormatLabel(selectedMatchFormat)} · {selectedMatch.status}
                      </span>
                    </div>

                    {renderTeamBattleLineupEditor(selectedMatch)}

                    <div className="set-entry-header">
                      <span>Entry</span>
                      {Array.from({ length: getBestOf(selectedMatchFormat) }, (_, index) => (
                        <span key={`set-header-${index}`}>Set {index + 1}</span>
                      ))}
                    </div>

                    {([
                      { side: 'A' as const, label: selectedMatch.participantAName || 'TBD' },
                      { side: 'B' as const, label: selectedMatch.participantBName || 'TBD' },
                    ]).map((participant) => (
                      <div className="set-entry-row" key={`${selectedMatch.id}-${participant.side}`}>
                        <strong>{participant.label}</strong>
                        {(participant.side === 'A'
                          ? matchForm.participantAScores
                          : matchForm.participantBScores
                        )
                          .slice(0, getBestOf(selectedMatchFormat))
                          .map((value, index) => (
                            <input
                              key={`${selectedMatch.id}-${participant.side}-${index}`}
                              type="number"
                              min={0}
                              value={value}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setMatchForm((current) => {
                                  const key =
                                    participant.side === 'A'
                                      ? 'participantAScores'
                                      : 'participantBScores';
                                  const nextScores = [...current[key]];
                                  nextScores[index] = nextValue;
                                  return {
                                    ...current,
                                    [key]: nextScores,
                                  };
                                });
                              }}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact-empty">
                    Select a match to enter multi-set scores.
                  </div>
                )}

                <div className="match-entry-actions">
                  <button className="primary-button" type="submit" disabled={saving || !selectedMatch}>
                    Save score
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={saving || !selectedMatch || selectedMatch.status !== 'COMPLETED'}
                    onClick={() => void clearMatchScore()}
                  >
                    Delete score
                  </button>
                </div>
              </form>

              <div className="panel-form">
                <h3>Tournament Management</h3>
                <div className="admin-list">
                  {manageableTournaments.length === 0 ? (
                    <p>No tournaments created yet.</p>
                  ) : (
                    manageableTournaments.map((tournament) => (
                      <div className="admin-list-item" key={tournament.id}>
                        <div>
                          <strong>{tournament.name}</strong>
                          <p>
                            {getModeLabel(tournament.mode)} · {getEventTypeLabel(tournament.eventType)} ·{' '}
                            {getMatchFormatLabel(tournament.matchFormat)}
                          </p>
                        </div>
                        <button
                          className="danger-button"
                          onClick={() => void deleteTournament(tournament.id)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="panel-form">
                <h3>Player Management</h3>
                <div className="admin-list">
                  {manageablePlayers.length === 0 ? (
                    <p>No players available.</p>
                  ) : (
                    manageablePlayers.map((player) => (
                      <div className="admin-list-item" key={player.id}>
                        <div>
                          <strong>{player.name}</strong>
                          <p>{String(player.gender).toLowerCase()}</p>
                        </div>
                        <button
                          className="danger-button"
                          onClick={() => void deletePlayer(player.id)}
                          type="button"
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
