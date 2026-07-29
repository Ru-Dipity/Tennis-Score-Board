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
  calculateGroupStandings,
  formatRoundRobinMatrix,
  parseScore,
  type ParticipantSeed,
} from './lib/tournament';

const client = generateClient<Schema>();

type Player = any;
type Team = any;
type Tournament = any;
type TournamentEntry = any;
type Match = any;
type Gender = 'MALE' | 'FEMALE' | 'MIXED' | 'UNSPECIFIED';
type TournamentMode = 'KNOCKOUT' | 'ROUND_ROBIN';
type EventType = 'SINGLES' | 'DOUBLES';

const ADMIN_GROUP = 'admin';

function authModeForAdmin(isAdmin: boolean) {
  return isAdmin ? ({ authMode: 'userPool' as const }) : undefined;
}

function isAmplifyListItem<T>(value: T | null | undefined): value is T {
  return Boolean(value);
}

function optionLabelForEntry(
  entry: TournamentEntry,
  playerMap: Map<string, Player>,
  teamMap: Map<string, Team>,
) {
  if (entry.teamId) {
    const team = teamMap.get(entry.teamId);
    if (team?.name) {
      return team.name;
    }
  }

  if (entry.playerId) {
    const player = playerMap.get(entry.playerId);
    if (player?.name) {
      return player.name;
    }
  }

  return entry.entryName;
}

function displayMatchScore(match: Match) {
  if (match.status === 'COMPLETED' && match.score === 'BYE') {
    return '轮空自动晋级';
  }

  return match.score || '待录入';
}

function groupKnockoutRounds(tournamentMatches: Match[]) {
  const roundMap = new Map<number, Match[]>();

  tournamentMatches.forEach((match) => {
    const bucket = roundMap.get(match.roundNumber) ?? [];
    bucket.push(match);
    roundMap.set(match.roundNumber, bucket);
  });

  return Array.from(roundMap.entries()).sort(([left], [right]) => left - right);
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
    selectedParticipantIds: [] as string[],
    groupCount: 2,
    qualifyPerGroup: 2,
    customRoundLabels: '',
  });
  const [matchForm, setMatchForm] = useState({
    matchId: '',
    winnerEntryId: '',
    score: '',
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

  const activeTournaments = useMemo(
    () =>
      [...tournaments]
        .filter((item) => item.status !== 'DRAFT')
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')),
    [tournaments],
  );

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const teamMap = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
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

        const standings =
          tournament.mode === 'ROUND_ROBIN'
            ? calculateGroupStandings(tournamentEntries as any[], tournamentMatches as any[])
            : [];

        return {
          tournament,
          entries: tournamentEntries,
          matches: tournamentMatches,
          standings,
        };
      }),
    [activeTournaments, entries, matches],
  );

  const manageableTournaments = useMemo(
    () =>
      [...tournaments].sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-Hans-CN'),
      ),
    [tournaments],
  );

  const editableMatches = useMemo(
    () =>
      [...matches]
        .filter(
          (match) =>
            match.status !== 'COMPLETED' ||
            (match.participantAEntryId && match.participantBEntryId),
        )
        .sort((left, right) => left.displayOrder - right.displayOrder),
    [matches],
  );

  async function checkAdminSession() {
    try {
      await getCurrentUser();
      const session = await fetchAuthSession();
      const groups =
        (session.tokens?.idToken?.payload['cognito:groups'] as string[] | undefined) ??
        [];
      setIsAdmin(groups.includes(ADMIN_GROUP));
      if (!groups.includes(ADMIN_GROUP)) {
        setAuthError('当前账号已登录，但未加入 admin 用户组。');
      } else {
        setAuthError('');
      }
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
      const message = error instanceof Error ? error.message : '登录失败，请检查账号密码。';
      setAuthError(message);
    }
  }

  async function handleSignOut() {
    await signOut();
    setIsAdmin(false);
    setAuthView('visitor');
  }

  async function createPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setSaving(true);
    setStatusMessage('');
    try {
      await client.models.Player.create(
        {
          name: playerForm.name.trim(),
          gender: playerForm.gender,
          isActive: true,
        } as any,
        authModeForAdmin(true),
      );
      setPlayerForm({ name: '', gender: 'UNSPECIFIED' });
      setStatusMessage('球员已创建。');
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
      setStatusMessage('请选择两位不同的球员组成双打队伍。');
      return;
    }

    if (teamForm.playerOneId === teamForm.playerTwoId) {
      setStatusMessage('双打组合不能选择同一位球员。');
      return;
    }

    const playerOne = playerMap.get(teamForm.playerOneId);
    const playerTwo = playerMap.get(teamForm.playerTwoId);
    const defaultName = [playerOne?.name, playerTwo?.name].filter(Boolean).join(' / ');

    setSaving(true);
    setStatusMessage('');
    try {
      await client.models.Team.create(
        {
          name: teamForm.name.trim() || defaultName,
          playerOneId: teamForm.playerOneId,
          playerTwoId: teamForm.playerTwoId,
        } as any,
        authModeForAdmin(true),
      );
      setTeamForm({ name: '', playerOneId: '', playerTwoId: '' });
      setStatusMessage('双打组合已创建。');
    } finally {
      setSaving(false);
    }
  }

  async function createTournament(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    const availableParticipants =
      tournamentForm.eventType === 'SINGLES' ? players : teams;

    if (tournamentForm.selectedParticipantIds.length < 2) {
      setStatusMessage('至少选择 2 个参赛对象。');
      return;
    }

    const participantSeeds: ParticipantSeed[] = tournamentForm.selectedParticipantIds
      .map((id) => {
        if (tournamentForm.eventType === 'SINGLES') {
          const player = playerMap.get(id);
          if (!player) {
            return null;
          }
          return {
            sourceId: player.id,
            displayName: player.name,
            participantType: 'PLAYER' as const,
            playerId: player.id,
          };
        }

        const team = teamMap.get(id);
        if (!team) {
          return null;
        }
        return {
          sourceId: team.id,
          displayName: team.name,
          participantType: 'TEAM' as const,
          teamId: team.id,
        };
      })
      .filter(isAmplifyListItem);

    if (participantSeeds.length < 2 || participantSeeds.length !== tournamentForm.selectedParticipantIds.length) {
      setStatusMessage('有部分参赛对象无效，请重新选择。');
      return;
    }

    const customRoundLabels = tournamentForm.customRoundLabels
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    setSaving(true);
    setStatusMessage('');

    try {
      const plan =
        tournamentForm.mode === 'KNOCKOUT'
          ? buildKnockoutPlan(participantSeeds, customRoundLabels)
          : buildRoundRobinPlan(participantSeeds, tournamentForm.groupCount);

      const isKnockout = tournamentForm.mode === 'KNOCKOUT';
      const tournamentPayload: any = {
        name: tournamentForm.name.trim(),
        mode: tournamentForm.mode,
        eventType: tournamentForm.eventType,
        status: 'LIVE',
        groupCount:
          tournamentForm.mode === 'ROUND_ROBIN' ? tournamentForm.groupCount : undefined,
        qualifyPerGroup:
          tournamentForm.mode === 'ROUND_ROBIN'
            ? tournamentForm.qualifyPerGroup
            : undefined,
        bracketSize: isKnockout ? (plan as any).bracketSize : undefined,
        roundLabels: isKnockout ? (plan as any).roundLabels : undefined,
        startedAt: new Date().toISOString(),
      };

      const { data: createdTournament } = await client.models.Tournament.create(
        tournamentPayload as any,
        authModeForAdmin(true),
      );

      if (!createdTournament) {
        throw new Error('赛事创建失败。');
      }

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
        };
        const { data: createdEntry } = await client.models.TournamentEntry.create(
          payload as any,
          authModeForAdmin(true),
        );
        if (createdEntry) {
          entryIdBySeed.set(entry.seed, createdEntry.id);
        }
      }

      for (const match of plan.matches) {
        const payload: any = {
          tournamentId: createdTournament.id,
          stage: match.stage,
          status: match.status,
          roundNumber: match.roundNumber,
          roundLabel: match.roundLabel,
          matchNumber: match.matchNumber,
          displayOrder: match.displayOrder,
          groupName: match.groupName,
          participantAEntryId: match.participantASeed
            ? entryIdBySeed.get(match.participantASeed)
            : undefined,
          participantAName: match.participantAName,
          participantBEntryId: match.participantBSeed
            ? entryIdBySeed.get(match.participantBSeed)
            : undefined,
          participantBName: match.participantBName,
          winnerEntryId: match.winnerSeed
            ? entryIdBySeed.get(match.winnerSeed)
            : undefined,
          score: match.score,
          completedAt: match.status === 'COMPLETED' ? new Date().toISOString() : undefined,
        };

        await client.models.Match.create(payload as any, authModeForAdmin(true));
      }

      setTournamentForm({
        name: '',
        mode: 'KNOCKOUT',
        eventType: 'SINGLES',
        selectedParticipantIds: [],
        groupCount: 2,
        qualifyPerGroup: 2,
        customRoundLabels: '',
      });
      setStatusMessage(
        `赛事「${createdTournament.name}」已创建，共 ${availableParticipants.length} 个可选参赛对象。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建赛事失败。';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function recordMatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || !matchForm.matchId || !matchForm.winnerEntryId || !matchForm.score.trim()) {
      return;
    }

    const match = matches.find((item) => item.id === matchForm.matchId);
    if (!match) {
      setStatusMessage('未找到待更新的比赛。');
      return;
    }

    const parsedScore = parseScore(matchForm.score);
    if (!parsedScore) {
      setStatusMessage('比分格式无效，请使用 6-4, 3-6, 10-8 这种格式。');
      return;
    }

    const expectedWinner =
      parsedScore.winner === 'A' ? match.participantAEntryId : match.participantBEntryId;
    if (expectedWinner !== matchForm.winnerEntryId) {
      setStatusMessage('比分结果与所选胜者不一致，请检查。');
      return;
    }

    setSaving(true);
    setStatusMessage('');

    try {
      await client.models.Match.update(
        {
          id: match.id,
          winnerEntryId: matchForm.winnerEntryId,
          score: matchForm.score.trim(),
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
        } as any,
        authModeForAdmin(true),
      );

      if (match.stage === 'KNOCKOUT') {
        const winnerEntry = entries.find((item) => item.id === matchForm.winnerEntryId);
        await cascadeKnockoutUpdate(match.id, {
          winnerEntryId: matchForm.winnerEntryId,
          winnerName: winnerEntry?.entryName ?? '',
        });
      }

      const tournament = tournaments.find((item) => item.id === match.tournamentId);
      if (tournament && tournament.mode === 'KNOCKOUT') {
        const tournamentMatches = matches.filter((item) => item.tournamentId === tournament.id);
        const finalMatch = tournamentMatches
          .filter((item) => item.stage === 'KNOCKOUT')
          .sort((left, right) => right.roundNumber - left.roundNumber)[0];

        if (finalMatch?.id === match.id) {
          await client.models.Tournament.update(
            {
              id: tournament.id,
              status: 'COMPLETED',
              completedAt: new Date().toISOString(),
            } as any,
            authModeForAdmin(true),
          );
        }
      }

      setMatchForm({ matchId: '', winnerEntryId: '', score: '' });
      setStatusMessage('比赛比分已保存。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存比分失败。';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  }

  async function cascadeKnockoutUpdate(
    sourceMatchId: string,
    winner: { winnerEntryId?: string; winnerName?: string } = {},
  ) {
    const currentMatch = matches.find((item) => item.id === sourceMatchId);
    if (!currentMatch) {
      return;
    }

    const nextMatch = matches.find(
      (item) =>
        item.tournamentId === currentMatch.tournamentId &&
        item.stage === 'KNOCKOUT' &&
        item.roundNumber === currentMatch.roundNumber + 1 &&
        item.matchNumber === Math.ceil(currentMatch.matchNumber / 2),
    );

    if (!nextMatch) {
      return;
    }

    const isLeftBracket = currentMatch.matchNumber % 2 === 1;
    const participantAEntryId = isLeftBracket
      ? winner.winnerEntryId ?? null
      : nextMatch.participantAEntryId ?? null;
    const participantAName = isLeftBracket
      ? winner.winnerName ?? null
      : nextMatch.participantAName ?? null;
    const participantBEntryId = isLeftBracket
      ? nextMatch.participantBEntryId ?? null
      : winner.winnerEntryId ?? null;
    const participantBName = isLeftBracket
      ? nextMatch.participantBName ?? null
      : winner.winnerName ?? null;

    const participants = [participantAEntryId, participantBEntryId].filter(Boolean);
    const winnerStillValid =
      nextMatch.winnerEntryId && participants.includes(nextMatch.winnerEntryId);

    const updatePayload: any = {
      id: nextMatch.id,
      participantAEntryId,
      participantAName,
      participantBEntryId,
      participantBName,
      status:
        participantAEntryId && participantBEntryId
          ? winnerStillValid && nextMatch.status === 'COMPLETED'
            ? 'COMPLETED'
            : 'IN_PROGRESS'
          : 'PENDING',
    };

    if (!winnerStillValid) {
      updatePayload.winnerEntryId = null;
      updatePayload.score = null;
      updatePayload.completedAt = null;
    }

    await client.models.Match.update(updatePayload as any, authModeForAdmin(true));

    if (!winnerStillValid) {
      await cascadeKnockoutUpdate(nextMatch.id, {});
    }
  }

  async function deleteTournament(tournamentId: string) {
    if (!isAdmin) {
      return;
    }

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
      setStatusMessage('赛事已删除。');
    } finally {
      setSaving(false);
    }
  }

  const availableParticipantOptions =
    tournamentForm.eventType === 'SINGLES'
      ? players.filter((player) => player.isActive)
      : teams;

  return (
    <div className="app-shell">
      <header className="hero-banner">
        <div>
          <p className="eyebrow">Tennis Tournament Control Center</p>
          <h1>网球比赛管理系统</h1>
          <p className="hero-copy">
            访客无需登录即可实时查看进行中的赛事、淘汰赛签表、小组赛积分表与历史战绩；
            管理员登录后可维护球员、双打组合、赛事与比分录入。
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>活跃赛事</span>
            <strong>{activeTournaments.length}</strong>
          </div>
          <div className="stat-card">
            <span>球员总数</span>
            <strong>{players.length}</strong>
          </div>
          <div className="stat-card">
            <span>比赛场次</span>
            <strong>{matches.length}</strong>
          </div>
        </div>
      </header>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <p className="section-tag">Visitor View</p>
            <h2>实时赛事大屏</h2>
          </div>
          <p className="section-desc">
            数据通过 Amplify Data 实时订阅刷新，管理员录入比分后，页面会自动更新。
          </p>
        </div>

        {tournamentCards.length === 0 ? (
          <div className="empty-state">
            暂无进行中的赛事。管理员创建赛事后，这里会自动展示实时赛况。
          </div>
        ) : (
          <div className="tournament-grid">
            {tournamentCards.map(({ tournament, entries: tournamentEntries, matches: tournamentMatches, standings }) => (
              <article className="tournament-card" key={tournament.id}>
                <div className="card-head">
                  <div>
                    <p className="meta-line">
                      {tournament.mode === 'KNOCKOUT' ? '淘汰赛' : '小组循环赛'} ·{' '}
                      {tournament.eventType === 'SINGLES' ? '单打' : '双打'}
                    </p>
                    <h3>{tournament.name}</h3>
                  </div>
                  <span className={`status-pill status-${tournament.status?.toLowerCase()}`}>
                    {tournament.status === 'COMPLETED'
                      ? '已结束'
                      : tournament.status === 'LIVE'
                        ? '进行中'
                        : '草稿'}
                  </span>
                </div>

                {tournament.mode === 'KNOCKOUT' ? (
                  <div className="bracket-rounds">
                    {groupKnockoutRounds(tournamentMatches).map(([round, roundMatches]) => (
                        <div className="round-column" key={`${tournament.id}-${round}`}>
                          <h4>{roundMatches[0]?.roundLabel ?? `第 ${round} 轮`}</h4>
                          {roundMatches.map((match) => (
                            <div className="match-box" key={match.id}>
                              <div className="slot-row">
                                <span>{match.participantAName || '待定'}</span>
                              </div>
                              <div className="slot-row">
                                <span>{match.participantBName || '待定'}</span>
                              </div>
                              <div className="match-foot">{displayMatchScore(match)}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="group-layout">
                    {standings.map((group) => (
                      <section className="group-card" key={`${tournament.id}-${group.groupName}`}>
                        <div className="group-head">
                          <h4>{group.groupName} 组</h4>
                          <span>前 {tournament.qualifyPerGroup ?? 2} 名出线</span>
                        </div>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>选手</th>
                                <th>积分</th>
                                <th>胜场</th>
                                <th>总胜局</th>
                                <th>净胜局</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.standings.map((row, index) => (
                                <tr
                                  key={row.entryId}
                                  className={
                                    index < (tournament.qualifyPerGroup ?? 2) ? 'qualified' : ''
                                  }
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
                                <th>{group.groupName} 组对阵</th>
                                {formatRoundRobinMatrix(
                                  tournamentEntries as any[],
                                  tournamentMatches as any[],
                                  group.groupName,
                                ).map((item) => (
                                  <th key={`${group.groupName}-${item.entry.id}`}>
                                    {item.entry.entryName}
                                  </th>
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
                )}

                <div className="history-list">
                  <h4>历史战绩</h4>
                  {tournamentMatches.filter((match) => match.status === 'COMPLETED').length === 0 ? (
                    <p className="history-empty">暂无已完赛记录。</p>
                  ) : (
                    tournamentMatches
                      .filter((match) => match.status === 'COMPLETED')
                      .map((match) => (
                        <div className="history-item" key={`${tournament.id}-${match.id}`}>
                          <div>
                            <strong>{match.participantAName || '待定'}</strong>
                            <span> vs </span>
                            <strong>{match.participantBName || '待定'}</strong>
                          </div>
                          <span>{displayMatchScore(match)}</span>
                        </div>
                      ))
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <p className="section-tag">Admin Console</p>
            <h2>管理员后台</h2>
          </div>
          <p className="section-desc">
            只有加入 Cognito `admin` 用户组的账号才能新增球员、创建赛事并录入比分。
          </p>
        </div>

        {!authChecked ? (
          <div className="empty-state">正在检查管理员会话...</div>
        ) : !isAdmin ? (
          <div className="admin-auth-layout">
            <div className="auth-switch">
              <button
                className={authView === 'visitor' ? 'active' : ''}
                onClick={() => setAuthView('visitor')}
                type="button"
              >
                访客说明
              </button>
              <button
                className={authView === 'admin' ? 'active' : ''}
                onClick={() => setAuthView('admin')}
                type="button"
              >
                管理员登录
              </button>
            </div>

            {authView === 'visitor' ? (
              <div className="empty-state">
                当前处于访客模式。切换到“管理员登录”后，可使用 Cognito 账号进入后台。
              </div>
            ) : (
              <div className="admin-login-grid">
                <form className="panel-form" onSubmit={handleAdminSignIn}>
                  <h3>管理员登录</h3>
                  <label>
                    邮箱
                    <input
                      type="email"
                      value={adminLogin.email}
                      onChange={(event) =>
                        setAdminLogin((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="admin@example.com"
                      required
                    />
                  </label>
                  <label>
                    密码
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
                    登录后台
                  </button>
                  {authError ? <p className="error-text">{authError}</p> : null}
                </form>

                <div className="panel-info">
                  <h3>管理员初始化建议</h3>
                  <ul>
                    <li>先在 Amplify Auth 中创建管理员账号。</li>
                    <li>将该账号加入 Cognito `admin` 用户组。</li>
                    <li>登录后即可使用下方管理能力。</li>
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
              <p>当前已使用管理员身份登录。</p>
              <button className="secondary-button" onClick={handleSignOut} type="button">
                退出登录
              </button>
            </div>

            {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

            <div className="admin-grid">
              <form className="panel-form" onSubmit={createPlayer}>
                <h3>新增球员</h3>
                <label>
                  姓名
                  <input
                    type="text"
                    value={playerForm.name}
                    onChange={(event) =>
                      setPlayerForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="例如：张三"
                    required
                  />
                </label>
                <label>
                  性别
                  <select
                    value={playerForm.gender}
                    onChange={(event) =>
                      setPlayerForm((current) => ({
                        ...current,
                        gender: event.target.value as Gender,
                      }))
                    }
                  >
                    <option value="UNSPECIFIED">未指定</option>
                    <option value="MALE">男</option>
                    <option value="FEMALE">女</option>
                    <option value="MIXED">混合</option>
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={saving}>
                  保存球员
                </button>
              </form>

              <form className="panel-form" onSubmit={createTeam}>
                <h3>创建双打组合</h3>
                <label>
                  队伍名称
                  <input
                    type="text"
                    value={teamForm.name}
                    onChange={(event) =>
                      setTeamForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="留空则自动按姓名生成"
                  />
                </label>
                <label>
                  选手 A
                  <select
                    value={teamForm.playerOneId}
                    onChange={(event) =>
                      setTeamForm((current) => ({
                        ...current,
                        playerOneId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">请选择球员</option>
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  选手 B
                  <select
                    value={teamForm.playerTwoId}
                    onChange={(event) =>
                      setTeamForm((current) => ({
                        ...current,
                        playerTwoId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">请选择球员</option>
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={saving}>
                  保存组合
                </button>
              </form>

              <form className="panel-form full-span" onSubmit={createTournament}>
                <h3>创建赛事</h3>
                <div className="form-grid">
                  <label>
                    赛事名称
                    <input
                      type="text"
                      value={tournamentForm.name}
                      onChange={(event) =>
                        setTournamentForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="例如：2026 夏季俱乐部杯 - 男单"
                      required
                    />
                  </label>
                  <label>
                    赛事模式
                    <select
                      value={tournamentForm.mode}
                      onChange={(event) =>
                        setTournamentForm((current) => ({
                          ...current,
                          mode: event.target.value as TournamentMode,
                        }))
                      }
                    >
                      <option value="KNOCKOUT">淘汰赛</option>
                      <option value="ROUND_ROBIN">小组循环赛</option>
                    </select>
                  </label>
                  <label>
                    比赛类型
                    <select
                      value={tournamentForm.eventType}
                      onChange={(event) =>
                        setTournamentForm((current) => ({
                          ...current,
                          eventType: event.target.value as EventType,
                          selectedParticipantIds: [],
                        }))
                      }
                    >
                      <option value="SINGLES">单打</option>
                      <option value="DOUBLES">双打</option>
                    </select>
                  </label>
                  {tournamentForm.mode === 'ROUND_ROBIN' ? (
                    <>
                      <label>
                        小组数量
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
                        每组出线人数
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
                  ) : (
                    <label className="wide-field">
                      自定义轮次名称
                      <input
                        type="text"
                        value={tournamentForm.customRoundLabels}
                        onChange={(event) =>
                          setTournamentForm((current) => ({
                            ...current,
                            customRoundLabels: event.target.value,
                          }))
                        }
                        placeholder="例如：资格赛, 8强, 半决赛, 决赛"
                      />
                    </label>
                  )}
                </div>

                <fieldset className="participant-picker">
                  <legend>
                    选择参赛{tournamentForm.eventType === 'SINGLES' ? '球员' : '双打组合'}
                  </legend>
                  <div className="participant-options">
                    {availableParticipantOptions.map((participant) => (
                      <label key={participant.id} className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={tournamentForm.selectedParticipantIds.includes(participant.id)}
                          onChange={(event) =>
                            setTournamentForm((current) => ({
                              ...current,
                              selectedParticipantIds: event.target.checked
                                ? [...current.selectedParticipantIds, participant.id]
                                : current.selectedParticipantIds.filter((id) => id !== participant.id),
                            }))
                          }
                        />
                        <span>{participant.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <button className="primary-button" type="submit" disabled={saving}>
                  生成赛事与赛程
                </button>
              </form>

              <form className="panel-form" onSubmit={recordMatch}>
                <h3>录入比分</h3>
                <label>
                  选择比赛
                  <select
                    value={matchForm.matchId}
                    onChange={(event) => {
                      const selectedMatchId = event.target.value;
                      const selectedMatch = editableMatches.find(
                        (match) => match.id === selectedMatchId,
                      );
                      setMatchForm({
                        matchId: selectedMatchId,
                        winnerEntryId: '',
                        score: selectedMatch?.score ?? '',
                      });
                    }}
                    required
                  >
                    <option value="">请选择比赛</option>
                    {editableMatches
                      .filter((match) => match.participantAEntryId && match.participantBEntryId)
                      .map((match) => (
                        <option key={match.id} value={match.id}>
                          {match.roundLabel} - {match.participantAName || '待定'} vs{' '}
                          {match.participantBName || '待定'}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  胜者
                  <select
                    value={matchForm.winnerEntryId}
                    onChange={(event) =>
                      setMatchForm((current) => ({
                        ...current,
                        winnerEntryId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">请选择胜者</option>
                    {(() => {
                      const selectedMatch = editableMatches.find(
                        (match) => match.id === matchForm.matchId,
                      );
                      if (!selectedMatch) {
                        return null;
                      }
                      return [selectedMatch.participantAEntryId, selectedMatch.participantBEntryId]
                        .filter(isAmplifyListItem)
                        .map((entryId) => {
                          const entry = entries.find((item) => item.id === entryId);
                          return entry ? (
                            <option key={entry.id} value={entry.id}>
                              {optionLabelForEntry(entry, playerMap, teamMap)}
                            </option>
                          ) : null;
                        });
                    })()}
                  </select>
                </label>
                <label>
                  比分
                  <input
                    type="text"
                    value={matchForm.score}
                    onChange={(event) =>
                      setMatchForm((current) => ({ ...current, score: event.target.value }))
                    }
                    placeholder="例如：6-4, 3-6, 10-8"
                    required
                  />
                </label>
                <button className="primary-button" type="submit" disabled={saving}>
                  保存比分
                </button>
              </form>

              <div className="panel-form">
                <h3>赛事管理</h3>
                <div className="admin-list">
                  {manageableTournaments.length === 0 ? (
                    <p>暂无赛事。</p>
                  ) : (
                    manageableTournaments.map((tournament) => (
                      <div className="admin-list-item" key={tournament.id}>
                        <div>
                          <strong>{tournament.name}</strong>
                          <p>
                            {tournament.mode === 'KNOCKOUT' ? '淘汰赛' : '小组循环赛'} ·{' '}
                            {tournament.eventType === 'SINGLES' ? '单打' : '双打'}
                          </p>
                        </div>
                        <button
                          className="danger-button"
                          onClick={() => void deleteTournament(tournament.id)}
                          type="button"
                        >
                          删除
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
