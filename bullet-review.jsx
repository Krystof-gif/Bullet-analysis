import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Upload, Zap, Swords, TrendingUp, TrendingDown, RotateCcw, Info } from "lucide-react";

const C = {
  bg: "#1b202b",
  panel: "#232a3a",
  panel2: "#2a3243",
  line: "#333d54",
  ink: "#edf0f5",
  inkMuted: "#8994ab",
  win: "#5fcf93",
  loss: "#e2596b",
  draw: "#c9a86a",
  amber: "#ffb454",
};

const SAMPLE_PGN = `[Event "Rated Bullet game"]
[White "vibe_knight"]
[Black "Tarrasch_Ghost"]
[Result "1-0"]
[UTCDate "2026.07.05"]
[UTCTime "08:12:04"]
[WhiteElo "1842"]
[BlackElo "1901"]
[WhiteRatingDiff "+7"]
[BlackRatingDiff "-7"]
[ECO "B01"]
[Opening "Scandinavian Defense"]
[TimeControl "60+0"]
[Termination "Normal"]

1. e4 d5 2. exd5 Qxd5 1-0

[Event "Rated Bullet game"]
[White "Pawnstorm77"]
[Black "vibe_knight"]
[Result "0-1"]
[UTCDate "2026.07.05"]
[UTCTime "08:19:41"]
[WhiteElo "1755"]
[BlackElo "1849"]
[WhiteRatingDiff "-6"]
[BlackRatingDiff "+6"]
[ECO "C50"]
[Opening "Italian Game"]
[TimeControl "60+0"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 0-1

[Event "Rated Bullet game"]
[White "vibe_knight"]
[Black "SigmaBlunder"]
[Result "0-1"]
[UTCDate "2026.07.05"]
[UTCTime "12:03:55"]
[WhiteElo "1855"]
[BlackElo "1702"]
[WhiteRatingDiff "-9"]
[BlackRatingDiff "+9"]
[ECO "B22"]
[Opening "Sicilian Defense, Alapin Variation"]
[TimeControl "60+0"]
[Termination "Time forfeit"]

1. e4 c5 2. c3 0-1

[Event "Rated Bullet game"]
[White "Rooksevelt"]
[Black "vibe_knight"]
[Result "1/2-1/2"]
[UTCDate "2026.07.05"]
[UTCTime "20:47:12"]
[WhiteElo "1888"]
[BlackElo "1846"]
[WhiteRatingDiff "+0"]
[BlackRatingDiff "+0"]
[ECO "B10"]
[Opening "Caro-Kann Defense"]
[TimeControl "60+0"]
[Termination "Normal"]

1. e4 c6 1/2-1/2`;

const EVAL_LOGISTIC_K = 0.00368208;
const OPENING_PLY_WINDOW = 14;
const OPENING_MOVES_FOR_ACCURACY = 10;
const LOW_TIME_BUCKETS = [
  { key: "lt10", label: "<10s", maxSec: 10 },
  { key: "lt5", label: "<5s", maxSec: 5 },
  { key: "lt2", label: "<2s", maxSec: 2 },
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function getGameIdFromSite(site) {
  if (!site) return null;
  const match = site.match(/lichess\.org\/([a-zA-Z0-9]{8})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function parseEvalToken(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  if (raw.startsWith("#")) {
    const mateIn = parseInt(raw.slice(1), 10);
    if (Number.isNaN(mateIn)) return null;
    const distance = Math.max(1, Math.abs(mateIn));
    // Mate scores are mapped to capped centipawns with distance decay.
    const magnitude = Math.max(350, 1000 - (distance - 1) * 60);
    return mateIn >= 0 ? magnitude : -magnitude;
  }

  const pawns = parseFloat(raw);
  if (Number.isNaN(pawns)) return null;
  return clamp(Math.round(pawns * 100), -1200, 1200);
}

function parseClockToken(token) {
  if (!token) return null;
  const raw = String(token).trim();
  const parts = raw.split(":").map((v) => parseInt(v, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return null;
}

function extractPlyAnnotationsFromPgn(pgnText) {
  const annotations = [];
  const commentRegex = /\{([^}]*)\}/g;
  let m;
  while ((m = commentRegex.exec(pgnText)) !== null) {
    const body = m[1];
    const evalMatch = body.match(/\[%eval\s+([^\]\s]+)\s*\]/i);
    const clkMatch = body.match(/\[%clk\s+([^\]\s]+)\s*\]/i);
    const cp = evalMatch ? parseEvalToken(evalMatch[1]) : null;
    const clockSec = clkMatch ? parseClockToken(clkMatch[1]) : null;
    if (cp != null || clockSec != null) annotations.push({ cp, clockSec });
  }
  return annotations;
}

function extractEvalSeriesFromPgn(pgnText) {
  return extractPlyAnnotationsFromPgn(pgnText)
    .map((a) => a.cp)
    .filter((cp) => cp != null);
}

function extractClockSeriesFromPgn(pgnText) {
  return extractPlyAnnotationsFromPgn(pgnText)
    .map((a) => a.clockSec)
    .filter((clockSec) => clockSec != null);
}

function buildEmptyTimePressure() {
  return LOW_TIME_BUCKETS.reduce((acc, b) => {
    acc[b.key] = {
      label: b.label,
      moves: 0,
      accuracySum: 0,
      blunders: 0,
    };
    return acc;
  }, {});
}

function finalizeTimePressureBuckets(buckets) {
  const result = {};
  LOW_TIME_BUCKETS.forEach((b) => {
    const item = buckets[b.key];
    result[b.key] = {
      label: b.label,
      moves: item.moves,
      blunders: item.blunders,
      avgAccuracy: item.moves ? item.accuracySum / item.moves : null,
      blunderRate: item.moves ? (item.blunders / item.moves) * 100 : null,
    };
  });
  return result;
}

async function fetchLichessAnalysis(gameId) {
  const url = `https://lichess.org/game/export/${gameId}?evals=true&pgnInJson=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Lichess API ${res.status}`);

  const body = await res.text();
  let payload = body;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    // Some proxies may still return plain PGN text.
  }

  const pgnFromApi = typeof payload === "string" ? payload : payload?.pgn || "";
  return {
    evals: extractEvalSeriesFromPgn(pgnFromApi),
    clocks: extractClockSeriesFromPgn(pgnFromApi),
  };
}

function cpToWhiteWinPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-EVAL_LOGISTIC_K * cp)) - 1);
}

function approxGameAccuracy(moveAccuracies) {
  if (!moveAccuracies.length) return null;
  const mean = moveAccuracies.reduce((s, a) => s + a, 0) / moveAccuracies.length;
  const harmonic =
    moveAccuracies.length /
    moveAccuracies.reduce((s, a) => s + 1 / Math.max(1, a), 0);
  const variance =
    moveAccuracies.reduce((s, a) => s + (a - mean) ** 2, 0) / moveAccuracies.length;
  const std = Math.sqrt(variance);

  // Approximation of Lichess-style aggregation: worse moves weigh more heavily.
  const blended = 0.65 * harmonic + 0.35 * (mean - 0.5 * std);
  return clamp(blended, 0, 100);
}

function moveAccuracy(beforeCpWhite, afterCpWhite, side) {
  const beforeW = cpToWhiteWinPercent(beforeCpWhite);
  const afterW = cpToWhiteWinPercent(afterCpWhite);
  const beforePlayer = side === "white" ? beforeW : 100 - beforeW;
  const afterPlayer = side === "white" ? afterW : 100 - afterW;
  const delta = Math.max(0, beforePlayer - afterPlayer);
  const acc = 103.1668 * Math.exp(-0.04354 * delta) - 3.1669;
  return clamp(acc, 0, 100);
}

function analyzeGameQuality(evals, side, clocks) {
  if (!evals || !evals.length || !side) return null;

  const ownMoves = [];
  for (let i = 0; i < evals.length; i += 1) {
    const ply = i + 1;
    const mover = ply % 2 === 1 ? "white" : "black";
    if (mover !== side) continue;

    const beforeCpWhite = i === 0 ? 0 : evals[i - 1];
    const afterCpWhite = evals[i];
    const beforeCpPlayer = side === "white" ? beforeCpWhite : -beforeCpWhite;
    const afterCpPlayer = side === "white" ? afterCpWhite : -afterCpWhite;
    const dropCp = beforeCpPlayer - afterCpPlayer;
    const acc = moveAccuracy(beforeCpWhite, afterCpWhite, side);
    const lostMateAdvantage =
      Math.abs(beforeCpPlayer) >= 900 && afterCpPlayer < beforeCpPlayer - 250;

    ownMoves.push({
      ply,
      dropCp,
      accuracy: acc,
      blunder: dropCp >= 100 || lostMateAdvantage,
      clockSec: Array.isArray(clocks) ? clocks[i] ?? null : null,
    });
  }

  if (!ownMoves.length) return null;

  const accuracies = ownMoves.map((m) => m.accuracy);
  const gameAccuracy = approxGameAccuracy(accuracies);
  const openingAccuracies = ownMoves.slice(0, OPENING_MOVES_FOR_ACCURACY).map((m) => m.accuracy);
  const openingAccuracy = openingAccuracies.length
    ? openingAccuracies.reduce((s, a) => s + a, 0) / openingAccuracies.length
    : null;

  const openingWindowMoves = ownMoves.filter((m) => m.ply <= OPENING_PLY_WINDOW);
  let bookDepth = openingWindowMoves.length;
  const firstDeviation = openingWindowMoves.findIndex((m) => m.dropCp > 10);
  if (firstDeviation >= 0) bookDepth = firstDeviation;

  const timePressureBuckets = buildEmptyTimePressure();
  ownMoves.forEach((m) => {
    if (m.clockSec == null) return;
    LOW_TIME_BUCKETS.forEach((bucket) => {
      if (m.clockSec <= bucket.maxSec) {
        timePressureBuckets[bucket.key].moves += 1;
        timePressureBuckets[bucket.key].accuracySum += m.accuracy;
        if (m.blunder) timePressureBuckets[bucket.key].blunders += 1;
      }
    });
  });

  return {
    gameAccuracy,
    openingAccuracy,
    bookDepth,
    blunderCount: ownMoves.filter((m) => m.blunder).length,
    timePressure: finalizeTimePressureBuckets(timePressureBuckets),
  };
}

function accuracyColor(acc) {
  if (acc == null) return C.inkMuted;
  if (acc > 90) return C.win;
  if (acc >= 75) return C.amber;
  return C.loss;
}

function parsePGNs(text) {
  const blocks = text
    .split(/(?=\[Event )/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    const headers = {};
    const re = /\[(\w+)\s+"([^"]*)"\]/g;
    let m;
    while ((m = re.exec(block)) !== null) headers[m[1]] = m[2];
    return {
      ...headers,
      _rawPgn: block,
      _gameId: getGameIdFromSite(headers.Site || ""),
      _evals: extractEvalSeriesFromPgn(block),
      _clocks: extractClockSeriesFromPgn(block),
    };
  });
}

function detectUsername(games) {
  const freq = {};
  games.forEach((g) => {
    if (g.White) freq[g.White] = (freq[g.White] || 0) + 1;
    if (g.Black) freq[g.Black] = (freq[g.Black] || 0) + 1;
  });
  let best = null,
    bestCount = 0;
  Object.entries(freq).forEach(([name, count]) => {
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  });
  return best;
}

function simplifyOpening(name) {
  if (!name) return "Unknown";
  return name.split(":")[0].split(",")[0].trim();
}

function analyzeGames(games, username, evalMeta) {
  const uname = username.trim().toLowerCase();
  const rows = games
    .map((g, idx) => {
      const isWhite = g.White && g.White.toLowerCase() === uname;
      const isBlack = g.Black && g.Black.toLowerCase() === uname;
      const side = isWhite ? "white" : isBlack ? "black" : null;
      if (!side) return null;
      const meta = evalMeta[idx] || { evals: [], clocks: [], source: "none" };
      const quality = analyzeGameQuality(meta.evals, side, meta.clocks);
      const oppName = side === "white" ? g.Black : g.White;
      const oppElo = parseInt(side === "white" ? g.BlackElo : g.WhiteElo, 10) || null;
      const ownElo = parseInt(side === "white" ? g.WhiteElo : g.BlackElo, 10) || null;
      const rdRaw = side === "white" ? g.WhiteRatingDiff : g.BlackRatingDiff;
      const ratingDiff = parseInt(rdRaw, 10);
      let outcome = "draw";
      if (g.Result === "1-0") outcome = side === "white" ? "win" : "loss";
      else if (g.Result === "0-1") outcome = side === "black" ? "win" : "loss";
      return {
        oppName: oppName || "Unknown",
        oppElo,
        ownElo,
        ratingDiff: isNaN(ratingDiff) ? 0 : ratingDiff,
        outcome,
        opening: simplifyOpening(g.Opening) || g.ECO || "Unknown",
        side,
        dateStr: g.UTCDate || "",
        timeStr: g.UTCTime || "",
        termination: g.Termination || "",
        accuracy: quality?.gameAccuracy ?? null,
        openingAccuracy: quality?.openingAccuracy ?? null,
        bookDepth: quality?.bookDepth ?? null,
        blunderCount: quality?.blunderCount ?? 0,
        timePressure: quality?.timePressure ?? null,
        evalStatus: quality ? "ok" : "missing",
        evalSource: meta.source,
      };
    })
    .filter(Boolean);

  rows.sort((a, b) => (a.dateStr + a.timeStr).localeCompare(b.dateStr + b.timeStr));
  rows.forEach((r, i) => {
    r.index = i + 1;
    r.label = r.timeStr ? r.timeStr.slice(0, 5) : `#${i + 1}`;
  });
  return rows;
}

function buildSummary(data) {
  const N = data.length;
  const wins = data.filter((d) => d.outcome === "win").length;
  const losses = data.filter((d) => d.outcome === "loss").length;
  const draws = N - wins - losses;
  const score = wins + draws * 0.5;
  const validOpp = data.filter((d) => d.oppElo);
  const avgOppElo = validOpp.length
    ? Math.round(validOpp.reduce((s, d) => s + d.oppElo, 0) / validOpp.length)
    : null;
  const perfRating =
    avgOppElo != null ? Math.round(avgOppElo + (400 * (wins - losses)) / N) : null;

  const wonGames = data.filter((d) => d.outcome === "win" && d.oppElo);
  const lostGames = data.filter((d) => d.outcome === "loss" && d.oppElo);
  const bestWin = wonGames.length
    ? wonGames.reduce((a, b) => (b.oppElo > a.oppElo ? b : a))
    : null;
  const worstLoss = lostGames.length
    ? lostGames.reduce((a, b) => (b.oppElo < a.oppElo ? b : a))
    : null;

  const first = data[0];
  const last = data[N - 1];
  const ratingChange =
    first && last && first.ownElo != null && last.ownElo != null
      ? last.ownElo + last.ratingDiff - first.ownElo
      : null;

  const withAccuracy = data.filter((d) => d.accuracy != null);
  const avgAccuracy = withAccuracy.length
    ? withAccuracy.reduce((s, d) => s + d.accuracy, 0) / withAccuracy.length
    : null;

  const timePressureBuckets = buildEmptyTimePressure();
  data.forEach((d) => {
    if (!d.timePressure) return;
    LOW_TIME_BUCKETS.forEach((bucket) => {
      const gameBucket = d.timePressure[bucket.key];
      if (!gameBucket || !gameBucket.moves) return;
      timePressureBuckets[bucket.key].moves += gameBucket.moves;
      timePressureBuckets[bucket.key].accuracySum += (gameBucket.avgAccuracy || 0) * gameBucket.moves;
      timePressureBuckets[bucket.key].blunders += gameBucket.blunders;
    });
  });

  return {
    N,
    wins,
    losses,
    draws,
    score,
    avgOppElo,
    perfRating,
    bestWin,
    worstLoss,
    ratingChange,
    avgAccuracy,
    timePressure: finalizeTimePressureBuckets(timePressureBuckets),
  };
}

function buildOpenings(data) {
  const map = {};
  data.forEach((d) => {
    if (!map[d.opening]) {
      map[d.opening] = {
        name: d.opening,
        games: 0,
        win: 0,
        loss: 0,
        draw: 0,
        openingAccSum: 0,
        openingAccCount: 0,
      };
    }
    map[d.opening].games += 1;
    map[d.opening][d.outcome] += 1;
    if (d.openingAccuracy != null) {
      map[d.opening].openingAccSum += d.openingAccuracy;
      map[d.opening].openingAccCount += 1;
    }
  });
  return Object.values(map)
    .map((o) => ({
      ...o,
      openingAccuracy:
        o.openingAccCount > 0 ? o.openingAccSum / o.openingAccCount : null,
    }))
    .sort((a, b) => b.games - a.games);
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        color: C.ink,
        maxWidth: 220,
      }}
    >
      <div style={{ color: C.inkMuted, marginBottom: 4 }}>
        Game #{p.index} · {p.label}
      </div>
      <div>
        vs {p.oppName} ({p.oppElo ?? "?"})
      </div>
      <div style={{ color: p.outcome === "win" ? C.win : p.outcome === "loss" ? C.loss : C.draw }}>
        {p.outcome.toUpperCase()} {p.ratingDiff >= 0 ? "+" : ""}
        {p.ratingDiff}
      </div>
      <div style={{ color: C.inkMuted }}>{p.opening}</div>
      <div style={{ color: accuracyColor(p.accuracy) }}>
        Acc: {p.accuracy != null ? `${p.accuracy.toFixed(1)}%` : "N/A"}
      </div>
    </div>
  );
}

function TiltPulse({ data }) {
  const w = 100;
  const h = 26;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  let cum = 0;
  const pts = data.map((d, i) => {
    cum += d.outcome === "win" ? 1 : d.outcome === "loss" ? -1 : 0;
    return { x: i * step, val: cum, outcome: d.outcome };
  });
  const maxAbs = Math.max(1, ...pts.map((p) => Math.abs(p.val)));
  const mid = h / 2;
  const scale = (h / 2 - 3) / maxAbs;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${(mid - p.val * scale).toFixed(2)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 44 }}>
      <line x1="0" y1={mid} x2={w} y2={mid} stroke={C.line} strokeWidth="0.4" strokeDasharray="1,1" />
      <path d={path} fill="none" stroke={C.amber} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={mid - p.val * scale}
          r="1.6"
          fill={p.outcome === "win" ? C.win : p.outcome === "loss" ? C.loss : C.draw}
        />
      ))}
    </svg>
  );
}

export default function BulletReview() {
  const [username, setUsername] = useState("");
  const [pgnText, setPgnText] = useState("");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState(null);
  const [recentDays, setRecentDays] = useState([]);
  const [storageReady, setStorageReady] = useState(true);

  const loadRecentDays = useCallback(async () => {
    try {
      const list = await window.storage.list("bulletday:", false);
      if (!list || !list.keys) return;
      const items = [];
      for (const key of list.keys.slice(-14)) {
        try {
          const res = await window.storage.get(key, false);
          if (res && res.value) items.push(JSON.parse(res.value));
        } catch (e) {
          /* skip missing */
        }
      }
      items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      setRecentDays(items);
    } catch (e) {
      setStorageReady(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("settings:username", false);
        if (res && res.value) setUsername(res.value);
      } catch (e) {
        /* no saved username yet */
      }
      loadRecentDays();
    })();
  }, [loadRecentDays]);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setPgnText(String(evt.target.result || ""));
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    setError("");
    if (!pgnText.trim()) {
      setError("Paste a PGN export from Lichess first (Profile → export games).");
      return;
    }
    const games = parsePGNs(pgnText);
    if (!games.length) {
      setError("Couldn't find any games in that text. Make sure it's a full PGN export.");
      return;
    }
    const uname = username.trim() || detectUsername(games);
    if (!uname) {
      setError("Couldn't figure out your username — type it in the field above.");
      return;
    }
    const evalMeta = await Promise.all(
      games.map(async (g) => {
        if (g._evals && g._evals.length) return { evals: g._evals, clocks: g._clocks || [], source: "pgn" };
        if (!g._gameId) return { evals: [], clocks: g._clocks || [], source: "none" };
        try {
          const apiAnalysis = await fetchLichessAnalysis(g._gameId);
          if (apiAnalysis.evals.length) {
            return {
              evals: apiAnalysis.evals,
              clocks: apiAnalysis.clocks,
              source: "api",
            };
          }
        } catch (e) {
          // Missing analysis or API/network issue -> per-game N/A in UI.
        }
        return { evals: [], clocks: g._clocks || [], source: "none" };
      })
    );

    const data = analyzeGames(games, uname, evalMeta);
    if (!data.length) {
      setError(`Couldn't find "${uname}" as a player in these games. Check the spelling.`);
      return;
    }
    const summary = buildSummary(data);
    const openings = buildOpenings(data);
    const date = data[0].dateStr || new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    setParsed({ data, summary, openings, uname, date });

    try {
      await window.storage.set("settings:username", uname, false);
      await window.storage.set(
        `bulletday:${date}`,
        JSON.stringify({ date, summary, uname, gamesCount: data.length }),
        false
      );
      loadRecentDays();
    } catch (e) {
      setStorageReady(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setPgnText("");
    setError("");
  };

  const chartData = parsed ? parsed.data : [];

  return (
    <div style={{ background: C.bg, minHeight: "100%", color: C.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .br-input {
          background: ${C.panel2};
          border: 1px solid ${C.line};
          color: ${C.ink};
          border-radius: 8px;
          padding: 10px 12px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          width: 100%;
          outline: none;
        }
        .br-input:focus { border-color: ${C.amber}; }
        .br-btn {
          background: ${C.amber};
          color: #1b1400;
          border: none;
          border-radius: 8px;
          padding: 10px 18px;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          letter-spacing: 0.02em;
        }
        .br-btn:hover { filter: brightness(1.08); }
        .br-btn-ghost {
          background: transparent;
          color: ${C.inkMuted};
          border: 1px solid ${C.line};
          border-radius: 8px;
          padding: 9px 14px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          cursor: pointer;
        }
        .br-btn-ghost:hover { color: ${C.ink}; border-color: ${C.amber}; }
        .br-panel { background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 12px; }
        .br-grid { display: grid; gap: 14px; }
        table.br-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.br-table th { text-align: left; color: ${C.inkMuted}; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 10px; border-bottom: 1px solid ${C.line}; }
        table.br-table td { padding: 8px 10px; border-bottom: 1px solid ${C.line}; }
        table.br-table tr:last-child td { border-bottom: none; }
        ::selection { background: ${C.amber}; color: #1b1400; }
      `}</style>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px 60px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: C.amber, letterSpacing: "0.12em", marginBottom: 4 }}>
              DAILY BULLET REVIEW
            </div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {parsed ? `${parsed.uname} · ${parsed.date}` : "Paste today's games"}
            </div>
          </div>
          {parsed && (
            <button className="br-btn-ghost" onClick={reset}>
              <RotateCcw size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              New day
            </button>
          )}
        </div>

        {!parsed && (
          <div className="br-panel" style={{ padding: 20 }}>
            <div className="br-grid" style={{ gridTemplateColumns: "1fr", marginBottom: 14 }}>
              <label className="mono" style={{ fontSize: 12, color: C.inkMuted }}>
                Lichess username (optional — auto-detected if left blank)
              </label>
              <input
                className="br-input"
                placeholder="e.g. vibe_knight"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <label className="mono" style={{ fontSize: 12, color: C.inkMuted }}>
              PGN — lichess.org export (use "Include headers" + ideally "Include evaluations" and "Include clocks")
            </label>
            <textarea
              className="br-input"
              style={{ marginTop: 8, minHeight: 160, resize: "vertical", lineHeight: 1.5 }}
              placeholder="[Event &quot;Rated Bullet game&quot;] ..."
              value={pgnText}
              onChange={(e) => setPgnText(e.target.value)}
            />

            {error && (
              <div className="mono" style={{ color: C.loss, fontSize: 12, marginTop: 10 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              <button className="br-btn" onClick={handleAnalyze}>
                <Zap size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Analyze the day
              </button>
              <label className="br-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Upload size={13} />
                Upload .pgn file
                <input type="file" accept=".pgn,.txt" onChange={handleFile} style={{ display: "none" }} />
              </label>
              <button
                className="br-btn-ghost"
                onClick={() => {
                  setPgnText(SAMPLE_PGN);
                  setUsername("vibe_knight");
                }}
              >
                Try sample data
              </button>
            </div>

            {recentDays.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 10, letterSpacing: "0.06em" }}>
                  RECENT DAYS ON THIS DEVICE
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {recentDays.map((d, i) => (
                    <div
                      key={i}
                      className="br-panel"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                    >
                      <div className="mono" style={{ color: C.inkMuted }}>{d.date}</div>
                      <div style={{ fontWeight: 600 }}>
                        {d.summary?.wins}W {d.summary?.losses}L {d.summary?.draws}D
                        {d.summary?.perfRating ? ` · perf ${d.summary.perfRating}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginTop: 8 }}>
                  <Info size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  Saved locally — syncing days with friends is coming later.
                </div>
              </div>
            )}
          </div>
        )}

        {parsed && (
          <>
            {/* Hero stats */}
            <div
              className="br-grid"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 16 }}
            >
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>PERFORMANCE</div>
                <div style={{ fontSize: 30, fontWeight: 700 }}>{parsed.summary.perfRating ?? "—"}</div>
              </div>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>AVG OPPONENT</div>
                <div style={{ fontSize: 30, fontWeight: 700 }}>{parsed.summary.avgOppElo ?? "—"}</div>
              </div>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>SCORE</div>
                <div style={{ fontSize: 30, fontWeight: 700 }}>
                  <span style={{ color: C.win }}>{parsed.summary.wins}</span>
                  {"–"}
                  <span style={{ color: C.loss }}>{parsed.summary.losses}</span>
                  {"–"}
                  <span style={{ color: C.draw }}>{parsed.summary.draws}</span>
                </div>
              </div>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>RATING CHANGE</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: parsed.summary.ratingChange >= 0 ? C.win : C.loss, display: "flex", alignItems: "center", gap: 6 }}>
                  {parsed.summary.ratingChange >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                  {parsed.summary.ratingChange != null
                    ? `${parsed.summary.ratingChange >= 0 ? "+" : ""}${parsed.summary.ratingChange}`
                    : "—"}
                </div>
              </div>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>AVG ACCURACY</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: accuracyColor(parsed.summary.avgAccuracy) }}>
                  {parsed.summary.avgAccuracy != null ? `${parsed.summary.avgAccuracy.toFixed(1)}%` : "N/A"}
                </div>
              </div>
            </div>

            <div className="br-panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 10 }}>
                TIME PRESSURE — your move quality under low clock
              </div>
              <div className="br-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                {LOW_TIME_BUCKETS.map((bucket) => {
                  const stats = parsed.summary.timePressure[bucket.key];
                  return (
                    <div key={bucket.key} className="br-panel" style={{ padding: 12, background: C.panel2 }}>
                      <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 4 }}>
                        {bucket.label}
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: C.inkMuted, marginBottom: 6 }}>
                        {stats.moves} moves
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: accuracyColor(stats.avgAccuracy) }}>
                        {stats.avgAccuracy != null ? `${stats.avgAccuracy.toFixed(1)}%` : "N/A"}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginTop: 4 }}>
                        Blunder rate: {stats.blunderRate != null ? `${stats.blunderRate.toFixed(0)}%` : "N/A"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tilt pulse */}
            <div className="br-panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>
                TILT PULSE — cumulative score through the day's {parsed.summary.N} games
              </div>
              <TiltPulse data={chartData} />
            </div>

            {/* Rating vs opponents chart */}
            <div className="br-panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 10 }}>
                YOUR RATING (line) VS OPPONENT RATING (dots) ACROSS THE DAY
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: C.inkMuted, fontSize: 11 }} axisLine={{ stroke: C.line }} tickLine={false} />
                  <YAxis tick={{ fill: C.inkMuted, fontSize: 11 }} axisLine={{ stroke: C.line }} tickLine={false} domain={["dataMin - 40", "dataMax + 40"]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="ownElo" stroke={C.amber} strokeWidth={2} dot={{ r: 2.5, fill: C.amber }} isAnimationActive={false} />
                  <Scatter
                    dataKey="oppElo"
                    isAnimationActive={false}
                    shape={(props) => {
                      const { cx, cy, payload } = props;
                      const color = payload.outcome === "win" ? C.win : payload.outcome === "loss" ? C.loss : C.draw;
                      return <circle cx={cx} cy={cy} r={5} fill={color} stroke={C.bg} strokeWidth={1.5} />;
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
                <Legend swatch={C.amber} label="Your rating" line />
                <Legend swatch={C.win} label="Win vs opponent" />
                <Legend swatch={C.loss} label="Loss vs opponent" />
                <Legend swatch={C.draw} label="Draw vs opponent" />
              </div>
            </div>

            {/* Best win / worst loss */}
            <div className="br-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>BIGGEST SCALP</div>
                {parsed.summary.bestWin ? (
                  <div>
                    <span style={{ fontWeight: 600 }}>{parsed.summary.bestWin.oppName}</span>{" "}
                    <span className="mono" style={{ color: C.inkMuted }}>({parsed.summary.bestWin.oppElo})</span>
                    <div className="mono" style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>
                      {parsed.summary.bestWin.opening} · game #{parsed.summary.bestWin.index}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: C.inkMuted, fontSize: 13 }}>No wins today.</div>
                )}
              </div>
              <div className="br-panel" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>COSTLIEST LOSS</div>
                {parsed.summary.worstLoss ? (
                  <div>
                    <span style={{ fontWeight: 600 }}>{parsed.summary.worstLoss.oppName}</span>{" "}
                    <span className="mono" style={{ color: C.inkMuted }}>({parsed.summary.worstLoss.oppElo})</span>
                    <div className="mono" style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>
                      {parsed.summary.worstLoss.opening} · game #{parsed.summary.worstLoss.index}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: C.inkMuted, fontSize: 13 }}>No losses today.</div>
                )}
              </div>
            </div>

            {/* Openings table */}
            <div className="br-panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 10 }}>OPENINGS TODAY</div>
              <table className="br-table">
                <thead>
                  <tr>
                    <th>Opening</th>
                    <th>Games</th>
                    <th>Score</th>
                    <th>Win rate</th>
                    <th>Opening accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.openings.map((o, i) => {
                    const winRate = Math.round(((o.win + o.draw * 0.5) / o.games) * 100);
                    return (
                      <tr key={i}>
                        <td>{o.name}</td>
                        <td className="mono">{o.games}</td>
                        <td className="mono">
                          <span style={{ color: C.win }}>{o.win}</span>–
                          <span style={{ color: C.loss }}>{o.loss}</span>–
                          <span style={{ color: C.draw }}>{o.draw}</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 70, height: 6, background: C.line, borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${winRate}%`, height: "100%", background: winRate >= 50 ? C.win : C.loss }} />
                            </div>
                            <span className="mono" style={{ fontSize: 12, color: C.inkMuted }}>{winRate}%</span>
                          </div>
                        </td>
                        <td className="mono" style={{ color: accuracyColor(o.openingAccuracy) }}>
                          {o.openingAccuracy != null ? `${o.openingAccuracy.toFixed(1)}%` : "N/A"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Game log */}
            <div className="br-panel" style={{ padding: "16px 18px" }}>
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginBottom: 10 }}>GAME LOG</div>
              <table className="br-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Opponent</th>
                    <th>Opening</th>
                    <th>Result</th>
                    <th>Δ</th>
                    <th>Accuracy (%)</th>
                    <th>Book depth</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((g) => (
                    <tr key={g.index}>
                      <td className="mono" style={{ color: C.inkMuted }}>{g.index}</td>
                      <td className="mono">{g.label}</td>
                      <td>
                        {g.oppName} <span className="mono" style={{ color: C.inkMuted }}>({g.oppElo ?? "?"})</span>
                      </td>
                      <td style={{ color: C.inkMuted }}>{g.opening}</td>
                      <td style={{ color: g.outcome === "win" ? C.win : g.outcome === "loss" ? C.loss : C.draw, fontWeight: 600 }}>
                        <Swords size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                        {g.outcome.toUpperCase()}
                      </td>
                      <td className="mono" style={{ color: g.ratingDiff >= 0 ? C.win : C.loss }}>
                        {g.ratingDiff >= 0 ? "+" : ""}
                        {g.ratingDiff}
                      </td>
                      <td className="mono" style={{ color: accuracyColor(g.accuracy) }}>
                        {g.accuracy != null
                          ? `${g.accuracy.toFixed(1)}%`
                          : g.evalStatus === "missing"
                            ? "N/A – nutná analýza"
                            : "N/A"}
                      </td>
                      <td className="mono" style={{ color: g.bookDepth != null ? C.ink : C.inkMuted }}>
                        {g.bookDepth != null
                          ? `${g.bookDepth}`
                          : g.evalStatus === "missing"
                            ? "N/A – nutná analýza"
                            : "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!storageReady && (
              <div className="mono" style={{ fontSize: 11, color: C.inkMuted, marginTop: 14 }}>
                Note: local saving isn't available right now, so this day won't be remembered next time.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label, line }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8994ab" }}>
      {line ? (
        <div style={{ width: 14, height: 2, background: swatch }} />
      ) : (
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: swatch }} />
      )}
      {label}
    </div>
  );
}
