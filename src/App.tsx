import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();

export default function App() {
  const [players, setPlayers] = useState<Array<Schema['Player']['type']>>([]);
  const [matches, setMatches] = useState<Array<Schema['Match']['type']>>([]);
  const [name, setName] = useState('');
  
  // 记分表单状态
  const [winner, setWinner] = useState('');
  const [loser, setLoser] = useState('');
  const [score, setScore] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const { data: p } = await client.models.Player.list();
    const { data: m } = await client.models.Match.list();
    setPlayers(p);
    setMatches(m);
  }

  // 1. 添加球员
async function addPlayer(e: React.FormEvent) {
  e.preventDefault();
  if (!name.trim()) return;
  // 加 as any 避开 Amplify SDK 的隐式退化误判
  await client.models.Player.create({ name } as any);
  setName('');
  fetchData();
}

  // 2. 保存比赛比分
async function saveMatch(e: React.FormEvent) {
  e.preventDefault();
  if (!winner || !loser || !score) {
    alert('请完整填写胜方、败方和比分！');
    return;
  }
  if (winner === loser) {
    alert('胜方和败方不能是同一个球员！');
    return;
  }

  // 加 as any 避开 Amplify SDK 的隐式退化误判
  await client.models.Match.create({
    matchType: '单打',
    winnerName: winner,
    loserName: loser,
    score: score,
    date: new Date().toLocaleDateString(),
  } as any);

  setScore('');
  setWinner('');
  setLoser('');
  fetchData();
}
  return (
    <div style={{ maxWidth: '600px', margin: '30px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      <h1 style={{ textAlign: 'center' }}>🎾 网球俱乐部记分板</h1>

      {/* 模块 1：录入球员 */}
      <section style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
        <h3>1. 添加网球俱乐部成员</h3>
        <form onSubmit={addPlayer} style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text"
            placeholder="输入球员姓名" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            style={{ flex: 1, padding: '8px' }}
          />
          <button type="submit" style={{ padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px' }}>添加</button>
        </form>
        <p style={{ marginTop: '10px', fontSize: '14px', color: '#555' }}>
          当前已有球员：{players.map((p) => p.name).join(', ') || '暂无，请先添加'}
        </p>
      </section>

      {/* 模块 2：录入比赛比分 */}
      <section style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
        <h3>2. 记录比赛结果</h3>
        <form onSubmit={saveMatch} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <select value={winner} onChange={(e) => setWinner(e.target.value)} style={{ flex: 1, padding: '8px' }}>
              <option value="">-- 选择胜方 (Winner) --</option>
              {players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
            <select value={loser} onChange={(e) => setLoser(e.target.value)} style={{ flex: 1, padding: '8px' }}>
              <option value="">-- 选择败方 (Loser) --</option>
              {players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <input 
            type="text"
            placeholder="输入比分（例如：6-4, 3-6, 10-8）" 
            value={score} 
            onChange={(e) => setScore(e.target.value)} 
            style={{ padding: '8px' }}
          />
          <button type="submit" style={{ padding: '10px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
            保存比赛成绩
          </button>
        </form>
      </section>

      {/* 模块 3：历史比分列表 */}
      <section style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', border: '1px solid #ddd' }}>
        <h3>3. 历史对局记录</h3>
        {matches.length === 0 ? (
          <p style={{ color: '#666' }}>暂无比赛记录，快去记一局吧！</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {matches.map((m) => (
              <li key={m.id} style={{ borderBottom: '1px solid #ddd', padding: '10px 0', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  🏆 <strong style={{ color: 'green' }}>{m.winnerName}</strong> 胜 <strong style={{ color: '#c00' }}>{m.loserName}</strong>
                  <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>比分：{m.score}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#999', alignSelf: 'center' }}>{m.date}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}