/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import {
  getCurrentUser,
  signIn,
  signOut,
  signUp,
  confirmSignUp,
  autoSignIn,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
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
  getKnockoutSuccessor,
  getMatchStatusLabel,
  isMatchScoreValid,
  type EventType,
  type MatchFormat,
  type ParticipantSeed,
  type TournamentMode,
  type WinnerSide,
} from './lib/tournament';

const client = generateClient<Schema>();

type Player = any;
type Team = any;
type TeamMember = any;
type EventGroup = any;
type Tournament = any;
type TournamentEntry = any;
type Match = any;
type Gender = 'MALE' | 'FEMALE' | 'MIXED' | 'UNSPECIFIED';

function ownerAuthMode() {
  return { authMode: 'userPool' as const };
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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [ownerLogin, setOwnerLogin] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [signUpForm, setSignUpForm] = useState({ email: '', password: '', confirmPassword: '', confirmationCode: '' });
  const [signUpStep, setSignUpStep] = useState<'form' | 'confirm'>('form');
  const [urlCleared, setUrlCleared] = useState(false);

  // URL query parameter parsing for spectator sharing
  // urlCleared state allows clearing params after login without page reload
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [urlCleared]);
  const sharedTournamentId = urlCleared ? null : urlParams.get('tournamentId');
  const sharedDate = urlParams.get('date');
  const sharedOwner = urlParams.get('owner');

  // Date picker state for owner tournament management
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [showArchived, setShowArchived] = useState(false);
  // Admin management tab switching: tournaments | players | teams
  const [adminTab, setAdminTab] = useState<'tournaments' | 'players' | 'teams'>('tournaments');
  // Visitor view: which Event to display ('all' shows every Event bracket vertically)
  const [selectedEventId, setSelectedEventId] = useState<string>('all');

  const [playerForm, setPlayerForm] = useState({
    name: '',
    gender: 'UNSPECIFIED' as Gender,
  });
  const [teamForm, setTeamForm] = useState({
    name: '',
    memberIds: [] as string[],
  });
  const [tournamentForm, setTournamentForm] = useState({
    name: '',
    eventName: '',
    mode: 'KNOCKOUT' as TournamentMode,
    eventType: 'SINGLES' as EventType,
    matchFormat: 'BEST_OF_3' as MatchFormat,
    groupCount: 2,
    qualifyPerGroup: 2,
    firstRoundMatches: 4,
    teamCount: 2,
    singlesPerDuel: 4,
    doublesPerDuel: 2,
    eventDate: todayStr,
  });
  const [matchForm, setMatchForm] = useState({
    matchId: '',
    participantAScores: createEmptyScoreInputs('BEST_OF_3'),
    participantBScores: createEmptyScoreInputs('BEST_OF_3'),
  });
  // Team battle scoring modal: the match currently being scored in the popup.
  const [scoringMatch, setScoringMatch] = useState<Match | null>(null);
  // Inline quick-create state for the bracket editor's "+ Create New" option.
  const [quickCreate, setQuickCreate] = useState<{
    matchId: string;
    side: WinnerSide;
    kind: 'PLAYER' | 'TEAM';
    name: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Subscribe to data based on authentication state.
  // - Authenticated: use 'userPool' mode → only sees own records (multi-tenant isolation)
  // - Unauthenticated: use 'apiKey' mode → sees all public records (read-only)
  useEffect(() => {
    const authMode = isAuthenticated ? 'userPool' : 'apiKey';
    const subscriptions = [
      client.models.Player.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setPlayers(items.filter(isAmplifyListItem)),
      }),
      client.models.Team.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setTeams(items.filter(isAmplifyListItem)),
      }),
      client.models.TeamMember.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setTeamMembers(items.filter(isAmplifyListItem)),
      }),
      client.models.EventGroup.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setEventGroups(items.filter(isAmplifyListItem)),
      }),
      client.models.Tournament.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setTournaments(items.filter(isAmplifyListItem)),
      }),
      client.models.TournamentEntry
        .observeQuery({ authMode })
        .subscribe({
          next: ({ items }) => setEntries(items.filter(isAmplifyListItem)),
        }),
      client.models.Match.observeQuery({ authMode }).subscribe({
        next: ({ items }) => setMatches(items.filter(isAmplifyListItem)),
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    };
  }, [isAuthenticated]);

  useEffect(() => {
    void checkAuthSession();
  }, []);

  // Listen for auth events (sign-up, sign-in, token refresh) to update state without refresh
  useEffect(() => {
    const listener = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
        case 'tokenRefresh':
          void checkAuthSession();
          break;
      }
    });
    return () => listener();
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

  // Map teamId -> ordered list of member playerIds
  const teamMemberIdsByTeam = useMemo(() => {
    const map = new Map<string, string[]>();
    teamMembers
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .forEach((member) => {
        const list = map.get(member.teamId) ?? [];
        list.push(member.playerId);
        map.set(member.teamId, list);
      });
    return map;
  }, [teamMembers]);

  // Resolve a team's member names (for display)
  function getTeamMemberNames(teamId: string): string[] {
    const ids = teamMemberIdsByTeam.get(teamId) ?? [];
    return ids
      .map((playerId) => playerMap.get(playerId)?.name)
      .filter((name): name is string => Boolean(name));
  }

  // Active tournaments: non-archived, non-DRAFT, filtered by selected date (owner view)
  // In spectator mode with sharedTournamentId, only show the specific shared
  // tournament(s). The shared id may be a single Tournament id or an EventGroup
  // id (a unified share of multiple Events), so match either field.
  const activeTournaments = useMemo(
    () =>
      [...tournaments]
        .filter((item) => {
          if (item.status === 'DRAFT') return false;
          if (sharedTournamentId) {
            return item.id === sharedTournamentId || item.eventGroupId === sharedTournamentId;
          }
          return !item.isArchived && item.eventDate === selectedDate;
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'en')),
    [tournaments, selectedDate, sharedTournamentId],
  );

  // Tournament ids owned by the current shared link (single id or whole group).
  const sharedTournamentIds = useMemo(() => {
    if (!sharedTournamentId) return new Set<string>();
    return new Set(
      tournaments
        .filter(
          (item) => item.id === sharedTournamentId || item.eventGroupId === sharedTournamentId,
        )
        .map((item) => item.id),
    );
  }, [tournaments, sharedTournamentId]);

  // Hero stats: context-aware computations
  // Spectator mode: only count data belonging to the shared tournament(s)
  const spectatorMatchCount = useMemo(
    () =>
      sharedTournamentId
        ? matches.filter((match) => sharedTournamentIds.has(match.tournamentId)).length
        : 0,
    [matches, sharedTournamentId, sharedTournamentIds],
  );
  const spectatorPlayerCount = useMemo(() => {
    if (!sharedTournamentId) return 0;
    const sharedEntryIds = new Set(
      entries.filter((entry) => sharedTournamentIds.has(entry.tournamentId)).map((entry) => entry.id),
    );
    // Count unique players referenced in matches of the shared tournament(s)
    const playerIds = new Set<string>();
    matches
      .filter((match) => sharedTournamentIds.has(match.tournamentId))
      .forEach((match) => {
        if (match.participantAEntryId && sharedEntryIds.has(match.participantAEntryId)) {
          const entry = entries.find((item) => item.id === match.participantAEntryId);
          if (entry?.playerId) playerIds.add(entry.playerId);
        }
        if (match.participantBEntryId && sharedEntryIds.has(match.participantBEntryId)) {
          const entry = entries.find((item) => item.id === match.participantBEntryId);
          if (entry?.playerId) playerIds.add(entry.playerId);
        }
      });
    return playerIds.size;
  }, [entries, matches, sharedTournamentId, sharedTournamentIds]);
  // Owner mode: only count non-archived tournament data
  const ownerActiveTournamentIds = useMemo(
    () => new Set(tournaments.filter((t) => !t.isArchived && t.status !== 'DRAFT').map((t) => t.id)),
    [tournaments],
  );
  const ownerMatchCount = useMemo(
    () => matches.filter((m) => ownerActiveTournamentIds.has(m.tournamentId)).length,
    [matches, ownerActiveTournamentIds],
  );
  const ownerPlayerCount = useMemo(
    () => players.filter((p) => p.isActive !== false).length,
    [players],
  );

  // When a spectator visits via sharedTournamentId, fetch the specific tournament data directly.
  // This ensures the tournament loads even if observeQuery with apiKey doesn't return it.
  useEffect(() => {
    if (!sharedTournamentId) return;
    let cancelled = false;
    async function fetchSharedTournament() {
      try {
        // The shared ID may be an EventGroup (unified sharing of multiple Events)
        // or a single Tournament. Resolve the set of Tournament ids to display.
        const groupResult = await client.models.EventGroup.get(
          { id: sharedTournamentId } as any,
          { authMode: 'apiKey' },
        );
        if (cancelled) return;

        let tournamentIds: string[] = [];
        if (groupResult.data) {
          // Shared link points to an EventGroup → load all Events under it.
          const groupTournaments = tournaments.filter(
            (t) => t.eventGroupId === sharedTournamentId,
          );
          tournamentIds = groupTournaments.map((t) => t.id);
          if (tournamentIds.length === 0) {
            const listResult = await client.models.Tournament.list({
              authMode: 'apiKey',
            });
            if (cancelled) return;
            const listedTournaments = (listResult.data ?? [])
              .filter(isAmplifyListItem)
              .filter((t) => t.eventGroupId === sharedTournamentId);
            tournamentIds = listedTournaments.map((t) => t.id);
            // Upsert the group's Tournament records so the bracket renders even
            // if observeQuery has not delivered them yet.
            if (tournamentIds.length > 0) {
              setTournaments((current) => {
                const next = [...current];
                listedTournaments.forEach((t) => {
                  const idx = next.findIndex((item) => item.id === t.id);
                  if (idx === -1) next.push(t as Tournament);
                  else next[idx] = t as Tournament;
                });
                return next;
              });
            }
          }
        } else {
          // Fall back to treating the ID as a single Tournament.
          const tournamentResult = await client.models.Tournament.get(
            { id: sharedTournamentId } as any,
            { authMode: 'apiKey' },
          );
          if (cancelled) return;
          if (tournamentResult.data) {
            tournamentIds = [tournamentResult.data.id];
            setTournaments((current) =>
              upsertLocalItem(current, tournamentResult.data as Tournament),
            );
          }
        }

        if (tournamentIds.length === 0) return;

        // Fetch all entries and matches with apiKey, then filter client-side
        const [allEntries, allMatches] = await Promise.all([
          client.models.TournamentEntry.list({ authMode: 'apiKey' }),
          client.models.Match.list({ authMode: 'apiKey' }),
        ]);
        if (cancelled) return;
        if (allEntries.data) {
          const filteredEntries = allEntries.data
            .filter(isAmplifyListItem)
            .filter((entry) => tournamentIds.includes(entry.tournamentId));
          setEntries((current) => {
            const next = [...current];
            filteredEntries.forEach((entry) => {
              const idx = next.findIndex((e) => e.id === entry.id);
              if (idx === -1) next.push(entry as TournamentEntry);
              else next[idx] = entry as TournamentEntry;
            });
            return next;
          });
        }
        if (allMatches.data) {
          const filteredMatches = allMatches.data
            .filter(isAmplifyListItem)
            .filter((match) => tournamentIds.includes(match.tournamentId));
          setMatches((current) => {
            const next = [...current];
            filteredMatches.forEach((match) => {
              const idx = next.findIndex((m) => m.id === match.id);
              if (idx === -1) next.push(match as Match);
              else next[idx] = match as Match;
            });
            return next;
          });
        }
      } catch {
        // Silently fail — observeQuery may still deliver the data
      }
    }
    void fetchSharedTournament();
    return () => { cancelled = true; };
  }, [sharedTournamentId]);

  // Archived tournaments for the owner's archived panel
  const archivedTournaments = useMemo(
    () =>
      [...tournaments]
        .filter((item) => item.isArchived)
        .sort((left, right) => {
          const dateCmp = (right.eventDate ?? '').localeCompare(left.eventDate ?? '');
          if (dateCmp !== 0) return dateCmp;
          return left.name.localeCompare(right.name, 'en');
        }),
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

  // Visitor view overall status: LIVE until every Event's Final is complete (or archived).
  const displayStatus = useMemo(() => {
    if (tournamentCards.length === 0) return 'LIVE';
    const allFinished = tournamentCards.every(({ tournament, matches: cardMatches }) => {
      if (tournament.isArchived || tournament.status === 'COMPLETED') return true;
      const finalMatch = getFinalMatch(cardMatches);
      return finalMatch ? finalMatch.status === 'COMPLETED' : false;
    });
    return allFinished ? 'FINISHED' : 'LIVE';
  }, [tournamentCards]);

  // Visitor view: the Event brackets to render based on the selected filter.
  const visibleTournamentCards = useMemo(() => {
    if (selectedEventId === 'all') return tournamentCards;
    return tournamentCards.filter(({ tournament }) => tournament.id === selectedEventId);
  }, [tournamentCards, selectedEventId]);

  const manageableTournaments = useMemo(
    () =>
      [...tournaments]
        .filter((item) => !item.isArchived)
        .sort((left, right) =>
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

  const manageableTeams = useMemo(
    () =>
      [...teams].sort((left, right) => left.name.localeCompare(right.name, 'en')),
    [teams],
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

  function copyToClipboard(text: string): Promise<void> {
    // Always try the modern Clipboard API first with a catch fallback.
    // On localhost, isSecureContext is true but clipboard.writeText may still fail
    // due to permissions. The fallback handles that case.
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text).catch(() => {
        // Fallback for environments where clipboard API fails (permissions, etc.)
        return fallbackCopy(text);
      });
    }
    // Fallback for environments without clipboard API
    return fallbackCopy(text);
  }

  function fallbackCopy(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        resolve();
      } catch {
        reject(new Error('Clipboard API not available'));
      }
    });
  }

  /** Clear tournamentId from URL and reset sharedTournamentId state */
  function clearUrlParams() {
    if (window.location.search.includes('tournamentId')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setUrlCleared(true);
    }
  }

  async function checkAuthSession() {
    try {
      await getCurrentUser();
      setIsAuthenticated(true);
      setAuthError('');
      // If already authenticated on page load, clean up any stray URL params
      clearUrlParams();
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthChecked(true);
    }
  }

  async function handleOwnerSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    try {
      await signIn({
        username: ownerLogin.email.trim(),
        password: ownerLogin.password,
      });
      // Clear stale public data before switching to owner-scoped queries
      setPlayers([]);
      setTeams([]);
      setTournaments([]);
      setEntries([]);
      setMatches([]);
      setIsAuthenticated(true);
      setOwnerLogin({ email: '', password: '' });
      // Close modal so user sees the Admin Console immediately
      closeAuthModal();
      // Clean up any spectator URL params to avoid mode confusion
      clearUrlParams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign in.';
      setAuthError(message);
    }
  }

  async function handleSignOut() {
    await signOut();
    // Clear owner-scoped data before switching back to public queries
    setPlayers([]);
    setTeams([]);
    setTournaments([]);
    setEntries([]);
    setMatches([]);
    setIsAuthenticated(false);
    setShowAuthModal(false);
  }

  async function handleSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    // Validate confirm password match
    if (signUpForm.password !== signUpForm.confirmPassword) {
      setAuthError('Passwords do not match. Please check and try again.');
      return;
    }
    try {
      await signUp({
        username: signUpForm.email.trim(),
        password: signUpForm.password,
        options: {
          userAttributes: {
            email: signUpForm.email.trim(),
          },
        },
      });
      // Move to confirmation step
      setSignUpStep('confirm');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign up.';
      setAuthError(message);
    }
  }

  async function handleConfirmSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    try {
      await confirmSignUp({
        username: signUpForm.email.trim(),
        confirmationCode: signUpForm.confirmationCode,
      });
      // Attempt auto-sign-in; fall back to regular sign-in if the flow has expired
      try {
        await autoSignIn();
      } catch (autoSignInError) {
        console.log('autoSignIn fell back to regular signIn:', autoSignInError);
        // Fallback: use the credentials the user just submitted
        await signIn({
          username: signUpForm.email.trim(),
          password: signUpForm.password,
        });
      }
      // Clear stale public data before switching to owner-scoped queries
      setPlayers([]);
      setTeams([]);
      setTournaments([]);
      setEntries([]);
      setMatches([]);
      setIsAuthenticated(true);
      setShowAuthModal(false);
      setSignUpForm({ email: '', password: '', confirmPassword: '', confirmationCode: '' });
      setSignUpStep('form');
      setIsSignUpMode(false);
      clearUrlParams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Confirmation failed.';
      setAuthError(message);
    }
  }

  function openAuthModal() {
    setAuthError('');
    setOwnerLogin({ email: '', password: '' });
    setSignUpForm({ email: '', password: '', confirmPassword: '', confirmationCode: '' });
    setSignUpStep('form');
    setIsSignUpMode(false);
    setShowAuthModal(true);
  }

  function closeAuthModal() {
    setShowAuthModal(false);
    setAuthError('');
  }

  function switchAuthMode() {
    setAuthError('');
    setSignUpForm({ email: '', password: '', confirmPassword: '', confirmationCode: '' });
    setSignUpStep('form');
    setIsSignUpMode((prev) => !prev);
  }

  function updateTournamentMode(nextEventType: EventType) {
    setTournamentForm((current) => ({
      ...current,
      eventType: nextEventType,
      mode: nextEventType === 'TEAM' ? 'TEAM_BATTLE' : current.mode === 'TEAM_BATTLE' ? 'KNOCKOUT' : current.mode,
    }));
  }

  function updateTeamCount(teamCount: number) {
    setTournamentForm((current) => ({
      ...current,
      teamCount,
    }));
  }

  async function createPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
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
        ownerAuthMode(),
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
    if (!isAuthenticated) {
      return;
    }

    const teamName = teamForm.name.trim();
    if (!teamName) {
      setStatusMessage('Please enter a team / club name.');
      return;
    }

    if (teamForm.memberIds.length < 1) {
      setStatusMessage('Please select at least one team member.');
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      const { data: createdTeam } = await client.models.Team.create(
        {
          name: teamName,
        } as any,
        ownerAuthMode(),
      );

      if (!createdTeam) {
        throw new Error('Team creation failed.');
      }
      setTeams((current) => upsertLocalItem(current, createdTeam as Team));

      // Create TeamMember records for each selected member
      const createdMembers: TeamMember[] = [];
      for (let index = 0; index < teamForm.memberIds.length; index += 1) {
        const playerId = teamForm.memberIds[index];
        const { data: member } = await client.models.TeamMember.create(
          {
            teamId: createdTeam.id,
            playerId,
            order: index + 1,
          } as any,
          ownerAuthMode(),
        );
        if (member) {
          createdMembers.push(member as TeamMember);
        }
      }
      if (createdMembers.length) {
        setTeamMembers((current) => {
          const next = [...current];
          createdMembers.forEach((member) => {
            const idx = next.findIndex((m) => m.id === member.id);
            if (idx === -1) next.push(member);
            else next[idx] = member;
          });
          return next;
        });
      }

      setTeamForm({ name: '', memberIds: [] });
      setStatusMessage(`Team "${createdTeam.name}" created successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create the team.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function createTournament(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      return;
    }

    const effectiveMode =
      tournamentForm.eventType === 'TEAM' ? 'TEAM_BATTLE' : tournamentForm.mode;

    if (!tournamentForm.name.trim()) {
      setStatusMessage('Tournament name is required.');
      return;
    }

    // Knockout draws require the admin-defined first-round match count. The
    // count drives the bracket size and automatic BYE placement.
    if (
      effectiveMode === 'KNOCKOUT' &&
      (!Number.isFinite(tournamentForm.firstRoundMatches) || tournamentForm.firstRoundMatches < 1)
    ) {
      setStatusMessage('Please enter the number of first-round matches for the knockout draw.');
      return;
    }

    // Team battle: teams are assigned from the system Team list directly on the
    // tournament display. The schedule is generated with default team slots and
    // TBD player placeholders; concrete rosters are synced per-team when an
    // admin picks a system team for each side of a duel.
    const teamCount = tournamentForm.teamCount;
    const singlesPerDuel = tournamentForm.singlesPerDuel;
    const doublesPerDuel = tournamentForm.doublesPerDuel;
    const firstRoundMatches = tournamentForm.firstRoundMatches;
    // Singles / Doubles: start with an empty bracket (TBD placeholders) and let
    // the admin assign participants directly on the tournament display.
    const participantSeeds: ParticipantSeed[] = [];

    setSaving(true);
    setStatusMessage('');

    try {
      // Find-or-create an EventGroup (the shared Tournament group) by name + date.
      // Multiple Events (Tournaments) can hang under the same EventGroup for unified sharing.
      const existingGroup = eventGroups.find(
        (group) => group.name === tournamentForm.name.trim() && group.eventDate === tournamentForm.eventDate,
      );
      let eventGroupId: string | undefined = existingGroup?.id;

      if (!eventGroupId) {
        const { data: createdGroup } = await client.models.EventGroup.create(
          {
            name: tournamentForm.name.trim(),
            eventDate: tournamentForm.eventDate,
            isArchived: false,
          } as any,
          ownerAuthMode(),
        );
        if (createdGroup) {
          eventGroupId = createdGroup.id;
          setEventGroups((current) => upsertLocalItem(current, createdGroup as EventGroup));
        }
      }

      const plan =
        effectiveMode === 'TEAM_BATTLE'
          ? buildTeamBattlePlan(
              participantSeeds,
              teamCount,
              singlesPerDuel,
              doublesPerDuel,
              tournamentForm.matchFormat,
            )
          : effectiveMode === 'KNOCKOUT'
            ? buildKnockoutPlan(
                firstRoundMatches,
                [],
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
        eventName: tournamentForm.eventName.trim() || undefined,
        eventGroupId,
        mode: effectiveMode,
        eventType: tournamentForm.eventType === 'TEAM' ? 'TEAM' : tournamentForm.eventType,
        status: 'LIVE',
        matchFormat: tournamentForm.matchFormat,
        eventDate: tournamentForm.eventDate,
        groupCount: effectiveMode === 'ROUND_ROBIN' ? tournamentForm.groupCount : undefined,
        qualifyPerGroup:
          effectiveMode === 'ROUND_ROBIN' ? tournamentForm.qualifyPerGroup : undefined,
        bracketSize: effectiveMode === 'KNOCKOUT' ? (plan as any).bracketSize : undefined,
        roundLabels: effectiveMode === 'KNOCKOUT' ? (plan as any).roundLabels : undefined,
        teamCount: effectiveMode === 'TEAM_BATTLE' ? teamCount : undefined,
        startedAt: new Date().toISOString(),
      };

      const { data: createdTournament } = await client.models.Tournament.create(
        tournamentPayload as any,
        ownerAuthMode(),
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
          ownerAuthMode(),
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
          ownerAuthMode(),
        );
        if (createdMatch) {
          setMatches((current) => upsertLocalItem(current, createdMatch as Match));
        }
      }

      setTournamentForm({
        name: '',
        eventName: '',
        mode: 'KNOCKOUT',
        eventType: 'SINGLES',
        matchFormat: 'BEST_OF_3',
        groupCount: 2,
        qualifyPerGroup: 2,
        firstRoundMatches: 4,
        teamCount: 2,
        singlesPerDuel: 4,
        doublesPerDuel: 2,
        eventDate: todayStr,
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
      ownerAuthMode(),
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

    const { roundNumber: nextRoundNumber, matchNumber: nextMatchNumber } =
      getKnockoutSuccessor(currentMatch);
    const nextMatch = localMatches.find(
      (match) =>
        match.tournamentId === currentMatch.tournamentId &&
        match.stage === 'KNOCKOUT' &&
        match.roundNumber === nextRoundNumber &&
        match.matchNumber === nextMatchNumber,
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

    const { data } = await client.models.Match.update(updatePayload as any, ownerAuthMode());
    const nextLocalMatches = mergeMatchState(
      localMatches,
      nextMatch.id,
      updatePayload,
      data as Match | null,
    );
    return cascadeKnockoutUpdate(nextMatch.id, {}, nextLocalMatches);
  }

  async function clearMatchScore(matchId?: string) {
    const targetMatch = matchId
      ? matches.find((match) => match.id === matchId)
      : selectedMatch;
    if (!isAuthenticated || !targetMatch) {
      return;
    }

    const updatePayload: any = {
      id: targetMatch.id,
      participantAScores: null,
      participantBScores: null,
      winnerEntryId: null,
      winnerSide: null,
      score: null,
      status:
        targetMatch.participantAName && targetMatch.participantBName
          ? 'IN_PROGRESS'
          : 'PENDING',
      completedAt: null,
    };

    setSaving(true);
    setStatusMessage('');

    try {
      const { data } = await client.models.Match.update(
        updatePayload as any,
        ownerAuthMode(),
      );
      let nextMatches = mergeMatchState(
        matches,
        targetMatch.id,
        updatePayload,
        data as Match | null,
      );
      setMatches(nextMatches);

      if (targetMatch.stage === 'KNOCKOUT') {
        nextMatches = await cascadeKnockoutUpdate(targetMatch.id, {}, nextMatches);
        setMatches(nextMatches);
      }

      await syncTournamentStatus(targetMatch.tournamentId, nextMatches);
      setMatchForm({
        matchId: targetMatch.id,
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
    if (!isAuthenticated) {
      return;
    }

    const targetTournament = tournaments.find((t) => t.id === tournamentId);
    const eventGroupId = targetTournament?.eventGroupId;

    const shouldResetSelectedMatch = matches.some(
      (match) => match.id === matchForm.matchId && match.tournamentId === tournamentId,
    );

    setSaving(true);
    setStatusMessage('');
    try {
      const tournamentMatches = matches.filter((match) => match.tournamentId === tournamentId);
      const tournamentEntries = entries.filter((entry) => entry.tournamentId === tournamentId);

      for (const match of tournamentMatches) {
        await client.models.Match.delete({ id: match.id } as any, ownerAuthMode());
      }

      for (const entry of tournamentEntries) {
        await client.models.TournamentEntry.delete(
          { id: entry.id } as any,
          ownerAuthMode(),
        );
      }

      await client.models.Tournament.delete(
        { id: tournamentId } as any,
        ownerAuthMode(),
      );
      setMatches((current) =>
        current.filter((match) => match.tournamentId !== tournamentId),
      );
      setEntries((current) =>
        current.filter((entry) => entry.tournamentId !== tournamentId),
      );
      setTournaments((current) => removeLocalItem(current, tournamentId));

      // If this was the last Event under its EventGroup, clean up the orphaned group
      // so it no longer appears in the historical name dropdown / share links.
      if (eventGroupId) {
        const remainingEvents = tournaments.filter(
          (t) => t.eventGroupId === eventGroupId && t.id !== tournamentId,
        );
        if (remainingEvents.length === 0) {
          await client.models.EventGroup.delete(
            { id: eventGroupId } as any,
            ownerAuthMode(),
          );
          setEventGroups((current) => removeLocalItem(current, eventGroupId));
        }
      }

      if (shouldResetSelectedMatch) {
        setMatchForm({
          matchId: '',
          participantAScores: createEmptyScoreInputs('BEST_OF_3'),
          participantBScores: createEmptyScoreInputs('BEST_OF_3'),
        });
      }
      setStatusMessage('Event deleted.');
    } finally {
      setSaving(false);
    }
  }

  async function archiveTournament(tournamentId: string) {
    if (!isAuthenticated) {
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Tournament.update(
        { id: tournamentId, isArchived: true } as any,
        ownerAuthMode(),
      );
      if (data) {
        setTournaments((current) =>
          upsertLocalItem(current, {
            ...(current.find((t) => t.id === tournamentId) ?? {}),
            ...data,
          } as Tournament),
        );
      }
      setStatusMessage('Tournament archived successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive tournament.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePlayer(playerId: string) {
    if (!isAuthenticated) {
      return;
    }

    const player = players.find((item) => item.id === playerId);
    const linkedMemberships = teamMembers.filter((member) => member.playerId === playerId);
    const linkedTeams = linkedMemberships
      .map((member) => teamMap.get(member.teamId))
      .filter(isAmplifyListItem);
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
          ownerAuthMode(),
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
          memberIds: current.memberIds.filter((id) => id !== playerId),
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
      await client.models.Player.delete({ id: playerId } as any, ownerAuthMode());
      setPlayers((current) => removeLocalItem(current, playerId));
      setTeamForm((current) => ({
        ...current,
        memberIds: current.memberIds.filter((id) => id !== playerId),
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
    if (!isAuthenticated) {
      return;
    }

    const team = teams.find((item) => item.id === teamId);
    const linkedEntries = entries.filter((entry) => entry.teamId === teamId);

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
      // Cascade delete all TeamMember records belonging to this team.
      const teamMembersToDelete = teamMembers.filter((member) => member.teamId === teamId);
      for (const member of teamMembersToDelete) {
        await client.models.TeamMember.delete({ id: member.id } as any, ownerAuthMode());
      }
      await client.models.Team.delete({ id: teamId } as any, ownerAuthMode());
      setTeams((current) => removeLocalItem(current, teamId));
      setTeamMembers((current) => current.filter((member) => member.teamId !== teamId));
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
    if (!isAuthenticated) {
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
        ownerAuthMode(),
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

  // Assign a system-created team to a Team Battle side. The team slot is
  // renamed across the whole tournament (labels + entry pool), so every
  // singles/doubles submatch of that team immediately uses the same roster.
  async function selectTeamBattleTeam(match: Match, side: WinnerSide, team: Team) {
    if (!isAuthenticated) {
      return;
    }
    const isA = side === 'A';
    const oldLabel = isA ? match.participantATeamLabel : match.participantBTeamLabel;
    const newLabel = team.name;
    const tournamentId = match.tournamentId;

    // Guard: the selected team must not already be bound to another slot of
    // this tournament (global mutual exclusion across all duels).
    const currentSlotLabel = isA ? match.participantATeamLabel : match.participantBTeamLabel;
    const otherSlotLabels = new Set(
      matches
        .filter((item) => item.tournamentId === tournamentId)
        .flatMap((item) => [item.participantATeamLabel, item.participantBTeamLabel])
        .filter((label): label is string => Boolean(label) && label !== currentSlotLabel),
    );
    if (otherSlotLabels.has(newLabel)) {
      setStatusMessage(
        `Team "${newLabel}" is already assigned to another slot in this tournament.`,
      );
      return;
    }

    const memberPlayers = (teamMemberIdsByTeam.get(team.id) ?? [])
      .map((playerId) => playerMap.get(playerId))
      .filter(isAmplifyListItem);
    const labelChanged = Boolean(oldLabel) && oldLabel !== newLabel;

    setSaving(true);
    setStatusMessage('');
    try {
      // 1) Rename this team slot across the whole tournament (entries + matches).
      let workingEntries: TournamentEntry[] = entries;
      if (labelChanged) {
        const slotEntryIds = new Set(
          entries
            .filter((entry) => entry.tournamentId === tournamentId && entry.groupName === oldLabel)
            .map((entry) => entry.id),
        );
        for (const entryId of slotEntryIds) {
          const payload = { id: entryId, groupName: newLabel };
          const { data } = await client.models.TournamentEntry.update(
            payload as any,
            ownerAuthMode(),
          );
          if (data) {
            setEntries((current) => upsertLocalItem(current, data as TournamentEntry));
          }
        }
        workingEntries = entries.map((entry) =>
          slotEntryIds.has(entry.id)
            ? ({ ...entry, groupName: newLabel } as TournamentEntry)
            : entry,
        );

        const slotMatches = matches.filter(
          (item) =>
            item.tournamentId === tournamentId &&
            (item.participantATeamLabel === oldLabel || item.participantBTeamLabel === oldLabel),
        );
        for (const item of slotMatches) {
          const payload: any = {
            id: item.id,
            participantATeamLabel:
              item.participantATeamLabel === oldLabel ? newLabel : item.participantATeamLabel,
            participantBTeamLabel:
              item.participantBTeamLabel === oldLabel ? newLabel : item.participantBTeamLabel,
          };
          const { data } = await client.models.Match.update(payload as any, ownerAuthMode());
          if (data) {
            setMatches((current) =>
              mergeMatchState(current, item.id, payload, data as Match | null),
            );
          }
        }
      }

      // 2) Sync the team's player pool into this tournament's entry records.
      const targetEntries = workingEntries
        .filter((entry) => entry.tournamentId === tournamentId && entry.groupName === newLabel)
        .sort(
          (left, right) =>
            (left.teamOrder ?? left.slotNumber ?? 0) - (right.teamOrder ?? right.slotNumber ?? 0),
        );
      for (let index = 0; index < memberPlayers.length; index += 1) {
        const member = memberPlayers[index];
        const entry = targetEntries[index];
        if (entry) {
          if (entry.playerId !== member.id || entry.entryName !== member.name) {
            const payload = { id: entry.id, playerId: member.id, entryName: member.name };
            const { data } = await client.models.TournamentEntry.update(
              payload as any,
              ownerAuthMode(),
            );
            if (data) {
              setEntries((current) => upsertLocalItem(current, data as TournamentEntry));
            }
          }
        } else {
          const { data: createdEntry } = await client.models.TournamentEntry.create(
            {
              tournamentId,
              participantType: 'PLAYER',
              playerId: member.id,
              entryName: member.name,
              seed: 0,
              groupName: newLabel,
              slotNumber: index + 1,
              isBye: false,
              teamOrder: index + 1,
            } as any,
            ownerAuthMode(),
          );
          if (createdEntry) {
            setEntries((current) => upsertLocalItem(current, createdEntry as TournamentEntry));
          }
        }
      }

      // 3) Reset this side's lineup so the admin assigns specific players per submatch.
      if (labelChanged) {
        const sidePayload: any = isA
          ? {
              id: match.id,
              participantAEntryId: null,
              participantAEntryIds: null,
              participantAName: null,
            }
          : {
              id: match.id,
              participantBEntryId: null,
              participantBEntryIds: null,
              participantBName: null,
            };
        const { data } = await client.models.Match.update(sidePayload as any, ownerAuthMode());
        if (data) {
          setMatches((current) => mergeMatchState(current, match.id, sidePayload, data as Match | null));
        }
      }

      setStatusMessage(
        `Team "${newLabel}" assigned to side ${side}. Now select the players for each submatch.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign the team.';
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
              {getMatchStatusLabel(match.status)}
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

  // Open the Team Battle scoring modal for a match row. The popup supports
  // selecting the on-court players for both sides and entering the score, with
  // Save Score / Confirm Match End / Clear actions.
  function openScoringModal(match: Match) {
    const matchFormat = (match.matchFormat || 'BEST_OF_3') as MatchFormat;
    setMatchForm({
      matchId: match.id,
      participantAScores: hydrateScoreInputs(match.participantAScores ?? [], matchFormat),
      participantBScores: hydrateScoreInputs(match.participantBScores ?? [], matchFormat),
    });
    setScoringMatch(match);
  }

  // Dedicated scoring popup for a Team Battle submatch row. It renders the two
  // team headers, per-side player lineups (singles: 1, doubles: 2), the score
  // inputs, and the Save Score / Confirm Match End / Clear action buttons.
  function renderTeamBattleScoringModal() {
    const match = scoringMatch
      ? matches.find((item) => item.id === scoringMatch.id) ?? scoringMatch
      : null;
    if (!match || match.stage !== 'TEAM_BATTLE') {
      return null;
    }

    const matchFormat = (match.matchFormat || 'BEST_OF_3') as MatchFormat;
    const setCount = getBestOf(matchFormat);
    const slotCount = match.matchCategory === 'TEAM_DOUBLES' ? 2 : 1;
    const isConfirmed = match.status === 'COMPLETED';
    const isEditingThisMatch = matchForm.matchId === match.id;
    const aScores = isEditingThisMatch
      ? matchForm.participantAScores
      : (match.participantAScores ?? []).map(String);
    const bScores = isEditingThisMatch
      ? matchForm.participantBScores
      : (match.participantBScores ?? []).map(String);
    const scoreIsValid = isMatchScoreValid(aScores, bScores, matchFormat);

    return (
      <div className="scoring-modal-overlay" onClick={() => setScoringMatch(null)}>
        <div className="scoring-modal" onClick={(event) => event.stopPropagation()}>
          <div className="scoring-modal-head">
            <div className="scoring-modal-title">
              <strong>Match Scoring</strong>
              <span className="scoring-modal-type">
                {match.matchCategory === 'TEAM_DOUBLES' ? 'Doubles' : 'Singles'}
              </span>
            </div>
            <span className={`status-pill status-${String(match.status).toLowerCase()}`}>
              {getMatchStatusLabel(match.status)}
            </span>
            <button
              className="scoring-modal-close"
              type="button"
              aria-label="Close scoring dialog"
              onClick={() => setScoringMatch(null)}
            >
              ×
            </button>
          </div>

          <div className="scoring-modal-sides">
            {(['A', 'B'] as WinnerSide[]).map((side) => {
              const isA = side === 'A';
              const scores = isA ? aScores : bScores;
              return (
                <div className="scoring-side" key={side}>
                  <div className="scoring-side-head">
                    <strong>
                      {isA
                        ? match.participantATeamLabel || 'Team A'
                        : match.participantBTeamLabel || 'Team B'}
                    </strong>
                  </div>
                  <div className="scoring-side-lineup">
                    {Array.from({ length: slotCount }, (_, index) =>
                      renderTeamBattleLineupSelect(match, side, index),
                    )}
                  </div>
                  <div className="editable-score-inputs">
                    {Array.from({ length: setCount }, (_, index) => (
                      <input
                        key={`${match.id}-${side}-${index}`}
                        className="inline-score-input"
                        type="number"
                        min={0}
                        value={scores[index] ?? ''}
                        disabled={saving || isConfirmed}
                        onChange={(event) => {
                          const value = event.target.value;
                          const key = isA ? 'participantAScores' : 'participantBScores';
                          const next = [...scores];
                          next[index] = value;
                          setMatchForm((current) => ({
                            ...current,
                            matchId: match.id,
                            [key]: next,
                          }));
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="scoring-modal-actions">
            {isConfirmed ? (
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void unlockMatch(match)}
                title="Reopen the match to correct participants or the score"
              >
                🔓 Unlock
              </button>
            ) : (
              <>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveInlineScore(match, aScores, bScores)}
                >
                  Save Score
                </button>
                <button
                  className="confirm-button"
                  type="button"
                  disabled={saving || !scoreIsValid}
                  onClick={() => void confirmMatchEnd(match, aScores, bScores)}
                  title="Finalize the match and lock the score"
                >
                  ✓ Confirm Match End
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void clearMatchScore(match.id)}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Participant dropdown inside the standard scoring modal. Singles offers
  // players, doubles offers teams. The select is bound to the current side so
  // the chosen participant never appears twice in the dropdown.
  function renderStandardModalParticipantSelect(match: Match, side: WinnerSide) {
    const isA = side === 'A';
    const currentName = isA ? match.participantAName : match.participantBName;
    const isDoubles = match.matchCategory === 'STANDARD_DOUBLES';
    const options = isDoubles
      ? manageableTeams.map((team) => ({ value: team.id, label: team.name }))
      : manageablePlayers.map((player) => ({ value: player.id, label: player.name }));
    const createKind: 'PLAYER' | 'TEAM' = isDoubles ? 'TEAM' : 'PLAYER';
    const currentValue = options.find((option) => option.label === currentName)?.value ?? '';

    return (
      <label className="team-lineup-select">
        <span>{isDoubles ? 'Doubles team' : 'Player'}</span>
        <select
          className="inline-participant-select"
          value={currentValue}
          disabled={saving || match.status === 'COMPLETED'}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__create__') {
              setQuickCreate({ matchId: match.id, side, kind: createKind, name: '' });
              return;
            }
            if (!value) {
              return;
            }
            const option = options.find((opt) => opt.value === value);
            void updateMatchParticipant(match, side, value, option?.label ?? 'TBD');
          }}
        >
          {!currentValue ? <option value="">{currentName || 'Select participant'}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="__create__">
            + Create New {createKind === 'TEAM' ? 'Team' : 'Player'}
          </option>
        </select>
      </label>
    );
  }

  // Dedicated scoring popup for a Singles/Doubles knockout match. Clicking a
  // bracket row opens this modal with the participant selects and score inputs;
  // the bracket itself stays compact (same interaction as Team Battle duels).
  function renderStandardMatchScoringModal() {
    const match = scoringMatch
      ? matches.find((item) => item.id === scoringMatch.id) ?? scoringMatch
      : null;
    if (!match || match.stage === 'TEAM_BATTLE') {
      return null;
    }

    const matchFormat = (match.matchFormat || 'BEST_OF_3') as MatchFormat;
    const setCount = getBestOf(matchFormat);
    const isConfirmed = match.status === 'COMPLETED';
    const isEditingThisMatch = matchForm.matchId === match.id;
    const aScores = isEditingThisMatch
      ? matchForm.participantAScores
      : (match.participantAScores ?? []).map(String);
    const bScores = isEditingThisMatch
      ? matchForm.participantBScores
      : (match.participantBScores ?? []).map(String);
    const scoreIsValid = isMatchScoreValid(aScores, bScores, matchFormat);
    const isByeMatch = match.score === 'BYE';
    const isByeSideA = match.participantAName === 'BYE';
    const isByeSideB = match.participantBName === 'BYE';

    return (
      <div className="scoring-modal-overlay" onClick={() => setScoringMatch(null)}>
        <div className="scoring-modal" onClick={(event) => event.stopPropagation()}>
          <div className="scoring-modal-head">
            <div className="scoring-modal-title">
              <strong>Match Scoring</strong>
              <span className="scoring-modal-type">
                {match.matchCategory === 'STANDARD_DOUBLES' ? 'Doubles' : 'Singles'}
              </span>
            </div>
            <span className={`status-pill status-${String(match.status).toLowerCase()}`}>
              {getMatchStatusLabel(match.status)}
            </span>
            <button
              className="scoring-modal-close"
              type="button"
              aria-label="Close scoring dialog"
              onClick={() => setScoringMatch(null)}
            >
              ×
            </button>
          </div>

          <div className="scoring-modal-sides">
            {(['A', 'B'] as WinnerSide[]).map((side) => {
              const isA = side === 'A';
              const scores = isA ? aScores : bScores;
              const isByeSide = isA ? isByeSideA : isByeSideB;
              return (
                <div className="scoring-side" key={side}>
                  <div className="scoring-side-head">
                    <strong>{isA ? 'Side A' : 'Side B'}</strong>
                  </div>
                  {isByeSide ? (
                    <span className="bye-badge">BYE</span>
                  ) : (
                    <>
                      {renderStandardModalParticipantSelect(match, side)}
                      <div className="editable-score-inputs">
                        {Array.from({ length: setCount }, (_, index) => (
                          <input
                            key={`${match.id}-${side}-${index}`}
                            className="inline-score-input"
                            type="number"
                            min={0}
                            value={scores[index] ?? ''}
                            disabled={saving || isConfirmed || isByeMatch}
                            onChange={(event) => {
                              const value = event.target.value;
                              const key = isA ? 'participantAScores' : 'participantBScores';
                              const next = [...scores];
                              next[index] = value;
                              setMatchForm((current) => ({
                                ...current,
                                matchId: match.id,
                                [key]: next,
                              }));
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="scoring-modal-actions">
            {isByeMatch ? (
              <span className="bye-note">
                {isConfirmed
                  ? 'BYE — participant automatically advanced to the next round.'
                  : 'BYE — assign the participant on the playing side to advance them automatically.'}
              </span>
            ) : isConfirmed ? (
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void unlockMatch(match)}
                title="Reopen the match to correct participants or the score"
              >
                🔓 Unlock
              </button>
            ) : (
              <>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveInlineScore(match, aScores, bScores)}
                >
                  Save Score
                </button>
                <button
                  className="confirm-button"
                  type="button"
                  disabled={saving || !scoreIsValid}
                  onClick={() => void confirmMatchEnd(match, aScores, bScores)}
                  title="Finalize the match and lock the score"
                >
                  ✓ Confirm Match End
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void clearMatchScore(match.id)}
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {quickCreate && quickCreate.matchId === match.id ? (
            <div className="quick-create-form">
              <strong>
                Create New {quickCreate.kind === 'TEAM' ? 'Team' : 'Player'} for{' '}
                {quickCreate.side === 'A' ? 'Side A' : 'Side B'}
              </strong>
              <input
                className="inline-score-input"
                type="text"
                placeholder={quickCreate.kind === 'TEAM' ? 'Team / club name' : 'Player name'}
                value={quickCreate.name}
                onChange={(event) =>
                  setQuickCreate((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
              <div className="editable-match-actions">
                <button
                  className="primary-button small"
                  type="button"
                  disabled={saving}
                  onClick={() => void handleQuickCreate()}
                >
                  Create
                </button>
                <button
                  className="secondary-button small"
                  type="button"
                  disabled={saving}
                  onClick={() => setQuickCreate(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── In-place bracket editing (admin) ─────────────────────────────────────
  // Update a match's participant on a given side. Supports singles (single
  // entry) and doubles (array of entries). Team battle uses the lineup editor.
  async function updateMatchParticipant(
    match: Match,
    side: WinnerSide,
    entryId: string,
    entryName: string,
  ) {
    if (!isAuthenticated) {
      return;
    }
    const isA = side === 'A';

    // For both singles and doubles, replace the side with the selected entry.
    const nextIds: string[] = [entryId];

    const updatePayload: any = {
      id: match.id,
      ...(isA
        ? {
            participantAEntryId: nextIds.length === 1 ? nextIds[0] : null,
            participantAEntryIds: nextIds.length ? nextIds : null,
            participantAName: entryName,
          }
        : {
            participantBEntryId: nextIds.length === 1 ? nextIds[0] : null,
            participantBEntryIds: nextIds.length ? nextIds : null,
            participantBName: entryName,
          }),
    };

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Match.update(updatePayload as any, ownerAuthMode());
      setMatches((current) => mergeMatchState(current, match.id, updatePayload, data as Match | null));

      // BYE auto-advance: in a knockout draw, when the participant on the
      // playing side of a BYE match is assigned, they automatically win the
      // match and advance to the next round. No score entry is needed.
      if (match.stage === 'KNOCKOUT') {
        const otherSideName = isA ? match.participantBName : match.participantAName;
        if (otherSideName === 'BYE') {
          const advancePayload: any = {
            id: match.id,
            status: 'COMPLETED',
            winnerSide: isA ? 'A' : 'B',
            winnerEntryId: entryId,
            score: 'BYE',
            completedAt: new Date().toISOString(),
          };
          const { data: advanceData } = await client.models.Match.update(
            advancePayload as any,
            ownerAuthMode(),
          );
          const withAdvance = mergeMatchState(
            matches,
            match.id,
            advancePayload,
            advanceData as Match | null,
          );
          setMatches(withAdvance);

          const nextMatches = await cascadeKnockoutUpdate(
            match.id,
            { winnerEntryIds: [entryId], winnerName: entryName },
            withAdvance,
          );
          setMatches(nextMatches);
          await syncTournamentStatus(match.tournamentId, nextMatches);
          setStatusMessage(`BYE match — "${entryName}" automatically advances to the next round.`);
          return;
        }
      }

      setStatusMessage('Match participant updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update participant.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  // Render a participant dropdown for in-place editing.
  function renderEditableParticipantSelect(
    match: Match,
    side: WinnerSide,
    tournament: Tournament,
  ) {
    const isA = side === 'A';
    const currentName = isA ? match.participantAName : match.participantBName;

    // For singles, offer players; for doubles, offer teams.
    const options =
      tournament.eventType === 'DOUBLES'
        ? manageableTeams.map((team) => ({ value: team.id, label: team.name }))
        : manageablePlayers.map((player) => ({ value: player.id, label: player.name }));

    const createKind: 'PLAYER' | 'TEAM' =
      tournament.eventType === 'DOUBLES' ? 'TEAM' : 'PLAYER';

    // A BYE side is not a selectable participant: show a prominent BYE badge.
    if (currentName === 'BYE') {
      return <span className="bye-badge">BYE</span>;
    }

    // Bind the select to the current participant so the dropdown never shows
    // a duplicate of the selected entry (placeholder + real option).
    const currentValue = options.find((option) => option.label === currentName)?.value ?? '';

    return (
      <select
        className="inline-participant-select"
        value={currentValue}
        onChange={(event) => {
          const value = event.target.value;
          if (value === '__create__') {
            setQuickCreate({
              matchId: match.id,
              side,
              kind: createKind,
              name: '',
            });
            return;
          }
          if (!value) {
            return;
          }
          const option = options.find((opt) => opt.value === value);
          void updateMatchParticipant(match, side, value, option?.label ?? 'TBD');
        }}
        disabled={saving || match.status === 'COMPLETED'}
      >
        {!currentValue ? <option value="">{currentName || 'TBD'}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value="__create__">
          + Create New {createKind === 'TEAM' ? 'Team' : 'Player'}
        </option>
      </select>
    );
  }

  // Render an editable match box with participant dropdowns and score inputs.
  function renderEditableMatchBox(match: Match, tournament: Tournament) {
    const matchFormat = (match.matchFormat || tournament.matchFormat || 'BEST_OF_3') as MatchFormat;
    const setCount = getBestOf(matchFormat);
    const isEditingThisMatch = matchForm.matchId === match.id;
    const isConfirmed = match.status === 'COMPLETED';
    const aScores = isEditingThisMatch
      ? matchForm.participantAScores
      : (match.participantAScores ?? []).map(String);
    const bScores = isEditingThisMatch
      ? matchForm.participantBScores
      : (match.participantBScores ?? []).map(String);
    const scoreIsValid = isMatchScoreValid(aScores, bScores, matchFormat);
    const isByeMatch = match.score === 'BYE';
    const isByeSideA = match.participantAName === 'BYE';
    const isByeSideB = match.participantBName === 'BYE';

    return (
      <div className="match-box editable-match-box" key={match.id}>
        <div className="editable-match-head">
          <span>{match.roundLabel}</span>
          <span className={`status-pill status-${String(match.status).toLowerCase()}`}>
            {getMatchStatusLabel(match.status)}
          </span>
        </div>
        {(['A', 'B'] as WinnerSide[]).map((side) => {
          const isA = side === 'A';
          const scores = isA ? aScores : bScores;
          const isByeSide = isA ? isByeSideA : isByeSideB;
          return (
            <div className="editable-slot" key={side}>
              {renderEditableParticipantSelect(match, side, tournament)}
              {!isByeSide ? (
                <div className="editable-score-inputs">
                  {Array.from({ length: setCount }, (_, index) => (
                    <input
                      key={`${match.id}-${side}-${index}`}
                      className="inline-score-input"
                      type="number"
                      min={0}
                      value={scores[index] ?? ''}
                      disabled={saving || isConfirmed || isByeMatch}
                      onChange={(event) => {
                        const value = event.target.value;
                        const key = isA ? 'participantAScores' : 'participantBScores';
                        const next = [...scores];
                        next[index] = value;
                        setMatchForm((current) => ({
                          ...current,
                          matchId: match.id,
                          [key]: next,
                        }));
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="editable-match-actions">
          {isByeMatch ? (
            <span className="bye-note">
              {isConfirmed
                ? 'BYE — participant automatically advanced to the next round.'
                : 'BYE — assign the participant on the playing side to advance them automatically.'}
            </span>
          ) : isConfirmed ? (
            <button
              className="secondary-button small"
              type="button"
              disabled={saving}
              onClick={() => void unlockMatch(match)}
              title="Reopen the match to correct participants or the score"
            >
              🔓 Unlock
            </button>
          ) : (
            <>
              <button
                className="primary-button small"
                type="button"
                disabled={saving}
                onClick={() => void saveInlineScore(match, aScores, bScores)}
              >
                Save Score
              </button>
              <button
                className="confirm-button small"
                type="button"
                disabled={saving || !scoreIsValid}
                onClick={() => void confirmMatchEnd(match, aScores, bScores)}
                title="Finalize the match and lock the score"
              >
                ✓ Confirm Match End
              </button>
              <button
                className="secondary-button small"
                type="button"
                disabled={saving}
                onClick={() => void clearMatchScore(match.id)}
              >
                Clear
              </button>
            </>
          )}
        </div>
        {quickCreate && quickCreate.matchId === match.id ? (
          <div className="quick-create-form">
            <strong>
              Create New {quickCreate.kind === 'TEAM' ? 'Team' : 'Player'} for{' '}
              {quickCreate.side === 'A' ? 'Side A' : 'Side B'}
            </strong>
            <input
              className="inline-score-input"
              type="text"
              placeholder={quickCreate.kind === 'TEAM' ? 'Team / club name' : 'Player name'}
              value={quickCreate.name}
              onChange={(event) =>
                setQuickCreate((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <div className="editable-match-actions">
              <button
                className="primary-button small"
                type="button"
                disabled={saving}
                onClick={() => void handleQuickCreate()}
              >
                Create
              </button>
              <button
                className="secondary-button small"
                type="button"
                disabled={saving}
                onClick={() => setQuickCreate(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // Compact, click-to-score bracket row for Singles/Doubles knockout draws.
  // The bracket only shows matchup info; the scoring panel opens in a modal
  // when the admin clicks the row (same interaction as Team Battle duels).
  function renderStandardMatchRow(match: Match) {
    const isByeMatch = match.score === 'BYE';

    return (
      <button
        className={`match-box standard-match-row ${isByeMatch ? 'bye-match-row' : ''}`}
        type="button"
        key={match.id}
        onClick={() => openScoringModal(match)}
        disabled={saving}
        title="Open the scoring panel for this match"
      >
        <div className="standard-match-head">
          <span className="standard-match-round">{match.roundLabel}</span>
          <span className={`status-pill status-${String(match.status).toLowerCase()}`}>
            {getMatchStatusLabel(match.status)}
          </span>
        </div>
        {(['A', 'B'] as WinnerSide[]).map((side) => {
          const isA = side === 'A';
          const participantName = isA ? match.participantAName : match.participantBName;
          const scores = getScoreList(match, side);
          return participantName === 'BYE' ? (
            <span className="bye-badge" key={side}>
              BYE
            </span>
          ) : (
            <div className="standard-match-slot" key={side}>
              <span className="participant-name">{participantName || 'TBD'}</span>
              <div className="set-score-strip">
                {scores.length ? (
                  scores.map((score, index) => (
                    <span className="set-score-cell" key={`${match.id}-${side}-${index}`}>
                      {score}
                    </span>
                  ))
                ) : (
                  <span className="set-score-placeholder">—</span>
                )}
              </div>
            </div>
          );
        })}
        <div className="match-foot">
          <span>{isByeMatch ? 'Automatic advance by BYE' : match.score || 'Score pending'}</span>
          <span className="standard-match-hint">Click to score</span>
        </div>
      </button>
    );
  }

  // Render a Team Battle team selector for a given side. The dropdown enforces
  // mutual exclusion: the team already picked for the opposite side is disabled,
  // so the same team can never be assigned to both sides of a duel.
  // When ignoreLocked is true the selector stays enabled even if the sample
  // match used for the duel header is already completed.
  function renderEditableTeamBattleSelect(
    match: Match,
    side: WinnerSide,
    ignoreLocked = false,
  ) {
    const isA = side === 'A';
    const teamLabel = isA ? match.participantATeamLabel : match.participantBTeamLabel;
    const currentName = isA ? match.participantAName : match.participantBName;
    const otherLabel = isA ? match.participantBTeamLabel : match.participantATeamLabel;

    // Bind the select to the slot's bound team so the dropdown never renders a
    // duplicate of the selected team (placeholder + real option).
    const currentTeamId = manageableTeams.find((team) => team.name === teamLabel)?.id ?? '';

    // Global mutual exclusion: a system team may only be bound to one slot in
    // this tournament. Collect every real team name already assigned to any
    // slot, excluding the slot this selector controls (so its team can still
    // be re-selected or changed to a free team).
    const realTeamNames = new Set(manageableTeams.map((team) => team.name));
    const assignedTeamNames = new Set<string>();
    matches
      .filter((item) => item.tournamentId === match.tournamentId)
      .forEach((item) => {
        if (item.participantATeamLabel && realTeamNames.has(item.participantATeamLabel)) {
          assignedTeamNames.add(item.participantATeamLabel);
        }
        if (item.participantBTeamLabel && realTeamNames.has(item.participantBTeamLabel)) {
          assignedTeamNames.add(item.participantBTeamLabel);
        }
      });

    return (
      <select
        className="inline-participant-select"
        value={currentTeamId}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) {
            return;
          }
          const team = manageableTeams.find((item) => item.id === value);
          if (!team) {
            return;
          }
          void selectTeamBattleTeam(match, side, team);
        }}
        disabled={saving || (!ignoreLocked && match.status === 'COMPLETED')}
      >
        {!currentTeamId ? (
          <option value="">{teamLabel || currentName || 'Select team'}</option>
        ) : null}
        {manageableTeams.map((team) => {
          const takenByOpponent = Boolean(otherLabel) && otherLabel === team.name;
          const takenElsewhere =
            assignedTeamNames.has(team.name) && team.name !== teamLabel;
          return (
            <option key={team.id} value={team.id} disabled={takenByOpponent || takenElsewhere}>
              {team.name}
            </option>
          );
        })}
      </select>
    );
  }

  // Save a score directly from an editable match box (in-place scoring).
  // Saving only marks the match "in progress" — it is NOT completed until the
  // admin explicitly confirms the match end (see confirmMatchEnd below).
  async function saveInlineScore(
    match: Match,
    aInputs: Array<string | number | null | undefined>,
    bInputs: Array<string | number | null | undefined>,
  ) {
    if (!isAuthenticated) {
      return;
    }
    const matchFormat = (match.matchFormat || 'BEST_OF_3') as MatchFormat;

    const evaluated = evaluateMatchScore(aInputs, bInputs, matchFormat);
    if (!evaluated) {
      setStatusMessage('Please enter a valid score line based on the selected match format.');
      return;
    }

    const winnerEntryId =
      evaluated.winner === 'A'
        ? match.participantAEntryId ?? null
        : match.participantBEntryId ?? null;
    const updatePayload: any = {
      id: match.id,
      participantAScores: evaluated.participantAScores,
      participantBScores: evaluated.participantBScores,
      winnerEntryId,
      winnerSide: evaluated.winner,
      score: evaluated.summary,
      status: 'IN_PROGRESS',
      completedAt: null,
    };

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Match.update(updatePayload as any, ownerAuthMode());
      const nextMatches = mergeMatchState(matches, match.id, updatePayload, data as Match | null);
      setMatches(nextMatches);

      setMatchForm({
        matchId: match.id,
        participantAScores: hydrateScoreInputs(evaluated.participantAScores, matchFormat),
        participantBScores: hydrateScoreInputs(evaluated.participantBScores, matchFormat),
      });
      setStatusMessage('Match score saved. The match is now In Progress — confirm the match end when it finishes.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save the match score.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  // Admin-only action: finalize a match. Once confirmed, the status becomes
  // COMPLETED and the score line is locked from further edits.
  async function confirmMatchEnd(
    match: Match,
    aInputs: Array<string | number | null | undefined>,
    bInputs: Array<string | number | null | undefined>,
  ) {
    if (!isAuthenticated) {
      return;
    }
    const matchFormat = (match.matchFormat || 'BEST_OF_3') as MatchFormat;

    if (!match.participantAName || !match.participantBName) {
      setStatusMessage('Please assign participants on both sides before confirming the match end.');
      return;
    }

    const evaluated = evaluateMatchScore(aInputs, bInputs, matchFormat);
    if (!evaluated) {
      setStatusMessage('Please enter a valid score line before confirming the match end.');
      return;
    }

    const winnerEntryId =
      evaluated.winner === 'A'
        ? match.participantAEntryId ?? null
        : match.participantBEntryId ?? null;
    const winnerEntryIds = getParticipantEntryIds(match, evaluated.winner);
    const winnerName =
      evaluated.winner === 'A' ? match.participantAName : match.participantBName;
    const updatePayload: any = {
      id: match.id,
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
      const { data } = await client.models.Match.update(updatePayload as any, ownerAuthMode());
      let nextMatches = mergeMatchState(matches, match.id, updatePayload, data as Match | null);
      setMatches(nextMatches);

      if (match.stage === 'KNOCKOUT') {
        nextMatches = await cascadeKnockoutUpdate(
          match.id,
          { winnerEntryIds, winnerName },
          nextMatches,
        );
        setMatches(nextMatches);
      }

      await syncTournamentStatus(match.tournamentId, nextMatches);
      setMatchForm({
        matchId: match.id,
        participantAScores: hydrateScoreInputs(evaluated.participantAScores, matchFormat),
        participantBScores: hydrateScoreInputs(evaluated.participantBScores, matchFormat),
      });
      setStatusMessage('Match confirmed as completed. The score is now locked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm the match end.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  // Admin-only action: reopen a completed match so wrong participant or score
  // data can be corrected. The winner propagation to later rounds is rolled back.
  async function unlockMatch(match: Match) {
    if (!isAuthenticated) {
      return;
    }

    const updatePayload: any = {
      id: match.id,
      status: 'IN_PROGRESS',
      completedAt: null,
    };

    setSaving(true);
    setStatusMessage('');
    try {
      const { data } = await client.models.Match.update(updatePayload as any, ownerAuthMode());
      let nextMatches = mergeMatchState(matches, match.id, updatePayload, data as Match | null);
      setMatches(nextMatches);

      if (match.stage === 'KNOCKOUT') {
        nextMatches = await cascadeKnockoutUpdate(match.id, {}, nextMatches);
        setMatches(nextMatches);
      }

      await syncTournamentStatus(match.tournamentId, nextMatches);
      setStatusMessage('Match unlocked. You can now correct participants or the score, then confirm again.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unlock the match.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  // Quick-create a Player or Team from the bracket editor, then assign it to
  // the match side that requested creation.
  async function handleQuickCreate() {
    if (!isAuthenticated || !quickCreate) {
      return;
    }
    const name = quickCreate.name.trim();
    if (!name) {
      setStatusMessage('Please enter a name for the new entry.');
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      let createdId: string;
      let createdName: string;
      if (quickCreate.kind === 'PLAYER') {
        const { data } = await client.models.Player.create(
          { name, gender: 'UNSPECIFIED' } as any,
          ownerAuthMode(),
        );
        if (!data) {
          throw new Error('Player creation failed.');
        }
        setPlayers((current) => upsertLocalItem(current, data as Player));
        createdId = data.id;
        createdName = data.name;
      } else {
        const { data: createdTeam } = await client.models.Team.create(
          { name } as any,
          ownerAuthMode(),
        );
        if (!createdTeam) {
          throw new Error('Team creation failed.');
        }
        setTeams((current) => upsertLocalItem(current, createdTeam as Team));
        createdId = createdTeam.id;
        createdName = createdTeam.name;
      }

      const match = matches.find((item) => item.id === quickCreate.matchId);
      if (match) {
        await updateMatchParticipant(match, quickCreate.side, createdId, createdName);
      }
      setQuickCreate(null);
      setStatusMessage(`${quickCreate.kind === 'PLAYER' ? 'Player' : 'Team'} created and assigned.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create the entry.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  // Determine if the page is in "bare visitor mode" (no URL params, no auth)
  const isBareVisitor = !sharedTournamentId && !sharedDate && !sharedOwner && !isAuthenticated;

  return (
    <div className="app-shell">
      <header className="hero-banner">
        <div className="hero-left">
          <span className="hero-tag">🎾 LIVE SCOREBOARD & TOURNAMENT CENTER</span>
          <h1>Tennis Score Board</h1>
          {isBareVisitor ? (
            <p className="hero-copy welcome-mode">
              Welcome to the Tennis Real-Time Scoring System. Please use the link provided by the
              tournament organizer to view schedules and live scores.
            </p>
          ) : sharedTournamentId ? (
            <p className="hero-copy spectator-mode">
              👁️ Spectator Mode — Viewing a shared tournament. Data updates in real time.
            </p>
          ) : (
            <p className="hero-copy">
              Real-time scores, interactive brackets, and team battle controls — simplified for players and owners.
            </p>
          )}
          <div className="hero-actions">
            {!isBareVisitor && (
              <button
                className="hero-btn hero-btn-primary"
                type="button"
                onClick={() => document.getElementById('live-tournament-display')?.scrollIntoView({ behavior: 'smooth' })}
              >
                🏆 View Live Draws
              </button>
            )}
            {!isAuthenticated ? (
              <button
                className="hero-btn hero-btn-secondary"
                type="button"
                onClick={openAuthModal}
              >
                🔑 Admin Login / Register
              </button>
            ) : (
              <button
                className="hero-btn hero-btn-secondary"
                type="button"
                onClick={() => document.getElementById('admin-management')?.scrollIntoView({ behavior: 'smooth' })}
              >
                ⚡ Admin Control
              </button>
            )}
          </div>
        </div>
        {!isBareVisitor && (
        <div className="hero-live-widget">
          <div className="live-widget-header">
            <span className="live-dot"></span>
            <span className="live-label">Live Overview</span>
          </div>
          <div className="live-widget-stats">
            <div className="live-stat-item">
              <span className="live-stat-label">Active tournaments</span>
              <strong className="live-stat-value">
                {sharedTournamentId
                  ? (activeTournaments.length > 0 ? 1 : 0)
                  : activeTournaments.length}
              </strong>
            </div>
            <div className="live-stat-divider"></div>
            <div className="live-stat-item">
              <span className="live-stat-label">Players</span>
              <strong className="live-stat-value">
                {sharedTournamentId ? spectatorPlayerCount : ownerPlayerCount}
              </strong>
            </div>
            <div className="live-stat-divider"></div>
            <div className="live-stat-item">
              <span className="live-stat-label">Matches</span>
              <strong className="live-stat-value">
                {sharedTournamentId ? spectatorMatchCount : ownerMatchCount}
              </strong>
            </div>
          </div>
          <div className="live-widget-footer">
            <span className="live-update-badge">● Live</span>
            <span>Auto-sync via Amplify</span>
          </div>
        </div>
        )}
      </header>

      {!isBareVisitor && (
      <section className="section-card" id="live-tournament-display">
        <div className="section-heading">
          <div>
            <p className="section-tag">Tournament Display</p>
            <h2>Tournament Display</h2>
          </div>
          <span className={`status-pill status-${displayStatus === 'FINISHED' ? 'completed' : 'live'}`}>
            {displayStatus === 'FINISHED' ? 'Finished' : 'LIVE'}
          </span>
        </div>

        {tournamentCards.length > 1 && (
          <div className="event-filter-bar">
            <button
              type="button"
              className={`event-filter-chip ${selectedEventId === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedEventId('all')}
            >
              All Events
            </button>
            {tournamentCards.map(({ tournament }) => (
              <button
                type="button"
                key={tournament.id}
                className={`event-filter-chip ${selectedEventId === tournament.id ? 'active' : ''}`}
                onClick={() => setSelectedEventId(tournament.id)}
              >
                {tournament.eventName || tournament.name}
              </button>
            ))}
          </div>
        )}

        {tournamentCards.length === 0 ? (
          <div className="empty-state">
            {sharedTournamentId
              ? 'The shared tournament could not be found or has no data available.'
              : 'No live tournament is available yet. Once an owner creates one, the public board will update automatically.'}
          </div>
        ) : (
          <div className="tournament-grid">
            {visibleTournamentCards.map(({ tournament, entries: tournamentEntries, matches: tournamentMatches, standings, teamSummary, teamDuels }) => {
              const finalMatch = getFinalMatch(tournamentMatches);
              return (
                <article className="tournament-card" key={tournament.id}>
                  <div className="card-head">
                    <div>
                      <p className="meta-line">
                        {getModeLabel(tournament.mode)} · {getEventTypeLabel(tournament.eventType)} ·{' '}
                        {getMatchFormatLabel(tournament.matchFormat)}
                      </p>
                      <h3>
                        {tournament.name}
                        {tournament.eventName ? (
                          <span className="card-event-name"> · {tournament.eventName}</span>
                        ) : null}
                      </h3>
                    </div>
                    <span className={`status-pill status-${finalMatch && finalMatch.status === 'COMPLETED' ? 'completed' : 'live'}`}>
                      {finalMatch && finalMatch.status === 'COMPLETED' ? 'Finished' : 'Live'}
                    </span>
                  </div>

                  {tournament.mode === 'KNOCKOUT' ? (
                    <div className="bracket-rounds">
                      {groupKnockoutRounds(tournamentMatches).map(([round, roundMatches]) => (
                        <div className="round-column" key={`${tournament.id}-${round}`}>
                          <h4>{roundMatches[0]?.roundLabel ?? `Round ${round}`}</h4>
                          {roundMatches.map((match) =>
                            isAuthenticated ? (
                              renderStandardMatchRow(match)
                            ) : (
                              <div className="match-box" key={match.id}>
                                {renderParticipantRow(match, 'A', finalMatch)}
                                {renderParticipantRow(match, 'B', finalMatch)}
                                <div className="match-foot">
                                  <span>{match.score === 'BYE' ? 'Automatic advance by BYE' : match.score || 'Score pending'}</span>
                                </div>
                              </div>
                            ),
                          )}
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

                  {tournament.mode === 'ROUND_ROBIN' && isAuthenticated ? (
                    <div className="display-match-editor">
                      <div className="display-editor-head">
                        <h4>Match Scoring</h4>
                        <span className="editor-hint">
                          Select the participants, enter the score and confirm the match end to lock it.
                        </span>
                      </div>
                      <div className="editable-bracket-grid">
                        {tournamentMatches.map((match) => renderEditableMatchBox(match, tournament))}
                      </div>
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

                            {isAuthenticated ? (
                              <div className="team-duel-main">
                                <div className="team-duel-vs-head">
                                  <div className="team-duel-vs-side">
                                    {renderEditableTeamBattleSelect(duel.matches[0], 'A', true)}
                                  </div>
                                  <span className="team-duel-vs-text">vs</span>
                                  <div className="team-duel-vs-side">
                                    {renderEditableTeamBattleSelect(duel.matches[0], 'B', true)}
                                  </div>
                                </div>
                                <div className="team-duel-schedule">
                                  {duel.matches.map((match) => (
                                    <button
                                      className="team-duel-row"
                                      type="button"
                                      key={match.id}
                                      onClick={() => openScoringModal(match)}
                                    >
                                      <span className="team-duel-row-type">
                                        {match.matchCategory === 'TEAM_DOUBLES'
                                          ? 'Doubles'
                                          : 'Singles'}
                                      </span>
                                      <span className="team-duel-row-players">
                                        <span>{match.participantAName || 'TBD'}</span>
                                        <span className="team-duel-row-vs">vs</span>
                                        <span>{match.participantBName || 'TBD'}</span>
                                      </span>
                                      <span className="team-duel-row-score">
                                        {getMatchDisplayScore(match)}
                                      </span>
                                      <span
                                        className={`status-pill status-${String(match.status).toLowerCase()}`}
                                      >
                                        {getMatchStatusLabel(match.status)}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="team-submatch-list">
                                {duel.matches.map((match) => renderTeamBattleMatchCard(match))}
                              </div>
                            )}
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
      )}

      {/* Admin Management — full dashboard for authenticated owners only */}
      {authChecked && isAuthenticated && (
        <section className="section-card" id="admin-management">
          <div className="section-heading">
            <div>
              <p className="section-tag">Admin Console</p>
              <h2>Admin Management</h2>
            </div>
            <p className="section-desc">
              The owner console manages tournament creation, seeded manual selection, random draw,
              players, and teams. Match scoring now happens directly on the tournament display below.
            </p>
          </div>

          <div className="admin-console">
            <div className="admin-topbar">
              <p>Signed in as owner.</p>
              <div className="admin-topbar-right">
                <label className="date-picker-label">
                  <span>Event date:</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(event) => setSelectedDate(event.target.value)}
                    className="date-picker-input"
                  />
                </label>
                <button className="secondary-button" onClick={handleSignOut} type="button">
                  Sign out
                </button>
              </div>
            </div>

            {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

            <div className="admin-tabs" role="tablist" aria-label="Admin management sections">
              <button
                className={`admin-tab-button ${adminTab === 'tournaments' ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={adminTab === 'tournaments'}
                onClick={() => setAdminTab('tournaments')}
              >
                🏆 Tournaments
              </button>
              <button
                className={`admin-tab-button ${adminTab === 'players' ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={adminTab === 'players'}
                onClick={() => setAdminTab('players')}
              >
                👤 Players
              </button>
              <button
                className={`admin-tab-button ${adminTab === 'teams' ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={adminTab === 'teams'}
                onClick={() => setAdminTab('teams')}
              >
                👥 Teams
              </button>
            </div>

            <div className="admin-grid">
              {adminTab === 'players' && (
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
              )}

              {adminTab === 'teams' && (
              <form className="panel-form" onSubmit={createTeam}>
                <h3>Create Team</h3>
                <label>
                  Team / club name
                  <input
                    type="text"
                    value={teamForm.name}
                    onChange={(event) =>
                      setTeamForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="e.g. TC Neureut Team A"
                    required
                  />
                </label>
                <fieldset className="member-picker">
                  <legend>Team members</legend>
                  {manageablePlayers.length === 0 ? (
                    <p className="empty-hint">No players available. Create players first.</p>
                  ) : (
                    manageablePlayers.map((player) => {
                      const checked = teamForm.memberIds.includes(player.id);
                      return (
                        <label key={player.id} className="member-checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setTeamForm((current) => {
                                const memberIds = event.target.checked
                                  ? [...current.memberIds, player.id]
                                  : current.memberIds.filter((id) => id !== player.id);
                                return { ...current, memberIds };
                              })
                            }
                          />
                          <span>{player.name}</span>
                        </label>
                      );
                    })
                  )}
                </fieldset>
                <button className="primary-button" type="submit" disabled={saving}>
                  Save team
                </button>
              </form>
              )}

              {adminTab === 'tournaments' && (
              <form className="panel-form full-span" onSubmit={createTournament}>
                <h3>Create Tournament</h3>

                <div className="form-grid">
                  <label>
                    Tournament name
                    <input
                      type="text"
                      list="tournament-name-options"
                      value={tournamentForm.name}
                      onChange={(event) =>
                        setTournamentForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="2026 Summer Club Cup"
                      required
                    />
                    <datalist id="tournament-name-options">
                      {eventGroups.map((group) => (
                        <option key={group.id} value={group.name} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Event name
                    <input
                      type="text"
                      value={tournamentForm.eventName}
                      onChange={(event) =>
                        setTournamentForm((current) => ({ ...current, eventName: event.target.value }))
                      }
                      placeholder="Men's Singles, Team Battle 50, ..."
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
                  <label>
                    Event date
                    <input
                      type="date"
                      value={tournamentForm.eventDate}
                      onChange={(event) =>
                        setTournamentForm((current) => ({
                          ...current,
                          eventDate: event.target.value,
                        }))
                      }
                      required
                    />
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
                        Singles per duel
                        <input
                          type="number"
                          min={1}
                          value={tournamentForm.singlesPerDuel}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              singlesPerDuel: Math.max(1, Number(event.target.value)),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Doubles per duel
                        <input
                          type="number"
                          min={1}
                          value={tournamentForm.doublesPerDuel}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              doublesPerDuel: Math.max(1, Number(event.target.value)),
                            }))
                          }
                        />
                      </label>
                    </>
                  )}

                  {tournamentForm.eventType !== 'TEAM' && tournamentForm.mode === 'KNOCKOUT' ? (
                    <label>
                      First round matches
                      <input
                        type="number"
                        min={1}
                        required
                        value={tournamentForm.firstRoundMatches}
                        onChange={(event) =>
                          setTournamentForm((current) => ({
                            ...current,
                            firstRoundMatches: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  ) : null}

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

                </div>

                <button className="primary-button" type="submit" disabled={saving}>
                  Create draw and schedule
                </button>
              </form>
              )}

              {adminTab === 'tournaments' && (
              <div className="panel-form">
                <h3>Tournament Management</h3>
                <div className="admin-list">
                  {manageableTournaments.length === 0 ? (
                    <p>No tournaments for this date.</p>
                  ) : (
                    manageableTournaments.map((tournament) => (
                      <div className="admin-list-item" key={tournament.id}>
                        <div>
                          <strong>{tournament.name}</strong>
                          {tournament.eventName ? (
                            <p className="event-name-line">{tournament.eventName}</p>
                          ) : null}
                          <p>
                            {getModeLabel(tournament.mode)} · {getEventTypeLabel(tournament.eventType)} ·{' '}
                            {getMatchFormatLabel(tournament.matchFormat)} ·{' '}
                            <span className="event-date-badge">{tournament.eventDate ?? 'No date'}</span>
                          </p>
                        </div>
                        <div className="admin-list-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => {
                              const shareId = tournament.eventGroupId ?? tournament.id;
                              const url = `${window.location.origin}${window.location.pathname}?tournamentId=${shareId}`;
                              copyToClipboard(url).then(() => {
                                setStatusMessage('🔗 Share link copied to clipboard!');
                              }).catch(() => {
                                setStatusMessage('Failed to copy link. Please copy the URL manually.');
                              });
                            }}
                            title="Copy spectator share link"
                          >
                            🔗 Share
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => void archiveTournament(tournament.id)}
                            disabled={saving}
                            title="Archive this tournament"
                          >
                            📦 Archive
                          </button>
                          <button
                            className="danger-button"
                            onClick={() => void deleteTournament(tournament.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              )}

              {/* Archived Tournaments Panel */}
              {adminTab === 'tournaments' && (
              <div className="panel-form">
                <div className="archived-header">
                  <h3>Archived Tournaments</h3>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setShowArchived((prev) => !prev)}
                  >
                    {showArchived ? 'Hide' : `Show (${archivedTournaments.length})`}
                  </button>
                </div>
                {showArchived && (
                  <div className="admin-list">
                    {archivedTournaments.length === 0 ? (
                      <p>No archived tournaments.</p>
                    ) : (
                      archivedTournaments.map((tournament) => (
                        <div className="admin-list-item" key={tournament.id}>
                          <div>
                            <strong>{tournament.name}</strong>
                            {tournament.eventName ? (
                              <p className="event-name-line">{tournament.eventName}</p>
                            ) : null}
                            <p>
                              {getModeLabel(tournament.mode)} · {getEventTypeLabel(tournament.eventType)} ·{' '}
                              {getMatchFormatLabel(tournament.matchFormat)} · {tournament.eventDate ?? 'No date'}
                            </p>
                          </div>
                          <div className="admin-list-actions">
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => {
                                const shareId = tournament.eventGroupId ?? tournament.id;
                                const url = `${window.location.origin}${window.location.pathname}?tournamentId=${shareId}`;
                                copyToClipboard(url).then(() => {
                                  setStatusMessage('🔗 Share link copied to clipboard!');
                                }).catch(() => {
                                  setStatusMessage('Failed to copy link. Please copy the URL manually.');
                                });
                              }}
                              title="Copy spectator share link"
                            >
                              🔗 Share
                            </button>
                            <button
                              className="danger-button"
                              onClick={() => void deleteTournament(tournament.id)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              )}

              {adminTab === 'players' && (
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
              )}

              {adminTab === 'teams' && (
              <div className="panel-form">
                <h3>Team Management</h3>
                <div className="admin-list">
                  {manageableTeams.length === 0 ? (
                    <p>No teams available.</p>
                  ) : (
                    manageableTeams.map((team) => {
                      const memberNames = getTeamMemberNames(team.id);
                      return (
                        <div className="admin-list-item" key={team.id}>
                          <div>
                            <strong>{team.name}</strong>
                            <p>
                              {memberNames.length
                                ? memberNames.join(' · ')
                                : 'No members'}
                            </p>
                          </div>
                          <button
                            className="danger-button"
                            onClick={() => void deleteTeam(team.id)}
                            type="button"
                            disabled={saving}
                          >
                            Delete
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Auth Modal (Sign In / Sign Up) ── */}
      {showAuthModal && (
        <div className="auth-modal-overlay">
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <button className="auth-modal-close" type="button" onClick={closeAuthModal}>
              ×
            </button>

            <div className="auth-modal-header">
              <h3>{isSignUpMode ? 'Create Account' : 'Admin Sign In'}</h3>
              <p className="auth-modal-desc">
                {isSignUpMode
                  ? 'Register a new owner account to manage tournaments, players, and teams.'
                  : 'Sign in with your owner account to manage tournaments, players, and teams.'}
              </p>
            </div>

            {isSignUpMode ? (
              <>
                {signUpStep === 'form' ? (
                  <form className="auth-modal-form" onSubmit={handleSignUp}>
                    <label>
                      Email
                      <input
                        type="email"
                        value={signUpForm.email}
                        onChange={(e) =>
                          setSignUpForm((prev) => ({ ...prev, email: e.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={signUpForm.password}
                        onChange={(e) =>
                          setSignUpForm((prev) => ({ ...prev, password: e.target.value }))
                        }
                        required
                        minLength={8}
                      />
                    </label>
                    <label>
                      Confirm Password
                      <input
                        type="password"
                        value={signUpForm.confirmPassword}
                        onChange={(e) =>
                          setSignUpForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                        }
                        required
                        minLength={8}
                      />
                    </label>
                    <button className="primary-button" type="submit">
                      Sign Up
                    </button>
                  </form>
                ) : (
                  <form className="auth-modal-form" onSubmit={handleConfirmSignUp}>
                    <p className="auth-modal-info">
                      A confirmation code has been sent to <strong>{signUpForm.email}</strong>.
                      Please enter it below to complete registration.
                    </p>
                    <label>
                      Confirmation Code
                      <input
                        type="text"
                        value={signUpForm.confirmationCode}
                        onChange={(e) =>
                          setSignUpForm((prev) => ({ ...prev, confirmationCode: e.target.value }))
                        }
                        placeholder="Enter the 6-digit code"
                        required
                      />
                    </label>
                    <button className="primary-button" type="submit">
                      Confirm & Sign In
                    </button>
                  </form>
                )}
              </>
            ) : (
              <form className="auth-modal-form" onSubmit={handleOwnerSignIn}>
                <label>
                  Email
                  <input
                    type="email"
                    value={ownerLogin.email}
                    onChange={(event) =>
                      setOwnerLogin((current) => ({
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
                    value={ownerLogin.password}
                    onChange={(event) =>
                      setOwnerLogin((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <button className="primary-button" type="submit">
                  Sign In
                </button>
              </form>
            )}

            {authError ? <p className="error-text auth-modal-error">{authError}</p> : null}

            <div className="auth-modal-footer">
              <span>
                {isSignUpMode
                  ? 'Already have an account?'
                  : "Don't have an account?"}
              </span>
              <button
                className="link-button"
                type="button"
                onClick={switchAuthMode}
              >
                {isSignUpMode ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renderTeamBattleScoringModal()}
      {renderStandardMatchScoringModal()}
    </div>
  );
}

export default App;
