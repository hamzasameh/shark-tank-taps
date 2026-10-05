import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Award,
  Check,
  Coins,
  Copy,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  TimerReset,
  Users,
  Wallet,
  X,
} from "lucide-react";
import "./App.css";

function getSavedSession() {
  try {
    return JSON.parse(sessionStorage.getItem("pitchday-session") || "null");
  } catch {
    return null;
  }
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function App() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState("home");
  const [mode, setMode] = useState("join");
  const [topic, setTopic] = useState("");
  const [initialBalance, setInitialBalance] = useState("1000");
  const [groupLimit, setGroupLimit] = useState("6");
  const [roomCode, setRoomCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [room, setRoom] = useState(null);
  const [member, setMember] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedSellerIds, setSelectedSellerIds] = useState([]);
  const [extraCredits, setExtraCredits] = useState("100");
  const [ideaDrafts, setIdeaDrafts] = useState({});
  const [editingIdeas, setEditingIdeas] = useState(false);
  const [revealNow, setRevealNow] = useState(0);

  useEffect(() => {
    const socket = io({ autoConnect: false });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      const saved = getSavedSession();
      if (saved) {
        socket.emit("room:resume", saved, (result) => {
          if (!result?.ok) {
            sessionStorage.removeItem("pitchday-session");
            setPage("home");
            return;
          }
          setMember(result.member);
          setRoom({ ...result.room, receivedAt: Date.now() });
          setPage("room");
        });
      }
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:state", (nextRoom) =>
      setRoom({ ...nextRoom, receivedAt: Date.now() }),
    );
    socket.connect();
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (room?.phase !== "revealing") return undefined;
    const intervalId = window.setInterval(() => setRevealNow(Date.now()), 100);
    return () => window.clearInterval(intervalId);
  }, [room?.phase]);

  const sellers = room?.groups.filter((group) => group.role === "seller") || [];
  const savedPitchCount = sellers.filter((seller) => seller.idea?.name).length;
  const investor = room?.groups.find((group) => group.role === "investor");
  const ownGroup = room?.groups.find((group) => group.id === member?.groupId);
  const isTeacher = member?.role === "teacher";
  const revealRemainingMs =
    room?.phase === "revealing"
      ? Math.max(
          0,
          room.revealRemainingMs -
            ((revealNow || room.receivedAt) - room.receivedAt),
        )
      : 0;
  const totalInvestment = sellers
    .filter(
      (seller) => selectedSellerIds.includes(seller.id) && !seller.dealLocked,
    )
    .reduce((sum, seller) => sum + Number(seller.idea?.request || 0), 0);

  function storeRoom(result) {
    const session = { code: result.room.code, ...result.member };
    sessionStorage.setItem("pitchday-session", JSON.stringify(session));
    setRoom({ ...result.room, receivedAt: Date.now() });
    setMember(result.member);
    setPage("room");
    setError("");
  }

  function action(eventName, payload, onSuccess) {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Connection lost. Rejoin the classroom Wi-Fi and try again.");
      return;
    }
    const callback = (result) => {
      if (!result?.ok) {
        setError(result?.error || "Could not complete that action.");
        return;
      }
      setError("");
      onSuccess?.(result);
    };
    if (payload === null) socket.emit(eventName, callback);
    else socket.emit(eventName, payload, callback);
  }

  function createRoom(event) {
    event.preventDefault();
    setBusy(true);
    action(
      "room:create",
      {
        topic,
        initialBalance: Number(initialBalance),
        groupLimit: Number(groupLimit),
      },
      (result) => {
        storeRoom(result);
        setBusy(false);
      },
    );
    window.setTimeout(() => setBusy(false), 10000);
  }

  function joinRoom(event) {
    event.preventDefault();
    setBusy(true);
    action("room:join", { code: roomCode, name: groupName }, (result) => {
      storeRoom(result);
      setBusy(false);
    });
    window.setTimeout(() => setBusy(false), 10000);
  }

  function saveIdea(event) {
    event.preventDefault();
    action("seller:updateIdea", ideaDrafts[ownGroup.id], () => {
      setEditingIdeas(false);
      setNotice("Your pitch details are saved.");
    });
  }

  function sendQuestion(event) {
    event.preventDefault();
    action("investor:ask", { question }, () => setQuestion(""));
  }

  function toggleSeller(id) {
    setSelectedSellerIds((current) =>
      current.includes(id)
        ? current.filter((sellerId) => sellerId !== id)
        : [...current, id],
    );
  }

  function confirmDeals() {
    action("investor:confirmDeals", { sellerIds: selectedSellerIds }, () => {
      setSelectedSellerIds([]);
    });
  }

  function grantCredits(event) {
    event.preventDefault();
    action("teacher:grantCredits", { amount: Number(extraCredits) }, () =>
      setNotice(`${extraCredits} $TAPS granted to the Investor.`),
    );
  }

  async function saveSessionCode() {
    try {
      await navigator.clipboard.writeText(room?.code || "");
      setNotice("Room code copied.");
    } catch {
      setNotice(`Room code: ${room?.code}`);
    }
  }

  function leaveDevice() {
    sessionStorage.removeItem("pitchday-session");
    setRoom(null);
    setMember(null);
    setPage("home");
    setError("");
    setNotice("");
  }

  if (page === "room" && room && member) {
    return (
      <main className="classroom-app">
        <header className="class-header">
          <a className="wordmark" href="#room">
            <span className="brand-icon">
              <Award size={18} />
            </span>
            <span>
              pitch<span>day</span>
            </span>
          </a>
          <div className="header-class-info">
            <div>
              <small>LESSON TOPIC</small>
              <strong>{room.topic}</strong>
            </div>
            <span className="header-rule" />
            <div>
              <small>INVESTOR BALANCE</small>
              <strong>
                {investor ? (
                  <>
                    {investor.credits.toLocaleString()} <em>$TAPS</em>
                  </>
                ) : (
                  <>
                    {room.initialBalance.toLocaleString()} <em>$TAPS</em> ·
                    pending assignment
                  </>
                )}
              </strong>
            </div>
          </div>
          <div className="header-user">
            <span
              className={`connection-dot ${connected ? "" : "disconnected"}`}
              title={connected ? "Connected" : "Reconnecting"}
            />
            <span>{isTeacher ? "Teacher" : ownGroup?.name}</span>
            <button
              className="icon-button"
              type="button"
              onClick={leaveDevice}
              title="Leave this device"
              aria-label="Leave this device"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="classroom-content" id="room">
          <section className="room-title">
            <div>
              <span className="eyebrow">
                CLASSROOM SHARK TANK <i /> ROOM {room.code}
              </span>
              <h1>
                {isTeacher
                  ? "Teacher dashboard"
                  : !ownGroup?.role
                    ? "Waiting for roles"
                    : ownGroup.role === "investor"
                      ? "You are the Investor"
                      : `Seller Group ${ownGroup.sellerNumber}`}
              </h1>
              <p>
                {room.phase === "lobby"
                  ? `${room.groups.length} of ${room.groupLimit} players have joined. Roles are assigned at random when everyone is here.`
                  : room.phase === "pitch"
                    ? `${sellers.length} seller pitches. Two minutes each. One investor.`
                    : room.phase === "investing"
                      ? "Choose the ideas you believe in and lock in your deals."
                      : room.phase === "revealing"
                        ? "The Investor's choices are being revealed."
                        : room.phase === "ended"
                          ? "The round is over. The final deals are locked."
                          : "This round is locked. Your choices cannot be changed."}
              </p>
            </div>
            <span className={`phase-pill ${room.phase}`}>
              <i />
              {room.phase === "lobby"
                ? "LOBBY"
                : room.phase === "pitch"
                  ? "PITCH ROUND"
                  : room.phase === "investing"
                    ? "INVESTMENT ROUND"
                    : room.phase === "revealing"
                      ? "DEAL REVEAL"
                      : room.phase === "ended"
                        ? "GAME OVER"
                        : "ROUND LOCKED"}
            </span>
          </section>

          {error && (
            <div className="alert alert-error" role="alert">
              <X size={16} />
              {error}
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success" role="status">
              <Check size={16} />
              {notice}
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {room.phase === "revealing" && (
            <DealReveal
              room={room}
              sellers={sellers}
              investor={investor}
              remainingMs={revealRemainingMs}
            />
          )}
          {room.phase === "ended" && (
            <GameOver room={room} sellers={sellers} investor={investor} />
          )}

          {room.phase === "lobby" && (
            <Lobby
              room={room}
              isTeacher={isTeacher}
              saveSessionCode={saveSessionCode}
              action={action}
            />
          )}

          {isTeacher && !["revealing", "ended"].includes(room.phase) && (
            <section className="admin-panel">
              <div className="admin-heading">
                <span className="admin-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <span className="eyebrow">TEACHER ADMIN</span>
                  <h2>Investor controls</h2>
                </div>
              </div>
              <div className="admin-balance">
                <span>
                  <small>INVESTOR BALANCE</small>
                  <strong>
                    {investor
                      ? investor.credits.toLocaleString()
                      : room.initialBalance.toLocaleString()}{" "}
                    <em>$TAPS</em>
                  </strong>
                </span>
                <span className="admin-investor">
                  {investor ? investor.name : "Random assignment pending"}
                </span>
              </div>
              <form className="grant-form" onSubmit={grantCredits}>
                <label htmlFor="grant-amount">Grant extra $TAPS</label>
                <div>
                  <input
                    id="grant-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={extraCredits}
                    onChange={(event) => setExtraCredits(event.target.value)}
                    required
                  />
                  <button
                    className="button button-green"
                    type="submit"
                    disabled={!investor}
                  >
                    Grant credits <Coins size={15} />
                  </button>
                </div>
              </form>
            </section>
          )}

          {ownGroup?.role === "investor" && room.phase === "pitch" && (
            <InvestorQuestion
              question={question}
              setQuestion={setQuestion}
              sendQuestion={sendQuestion}
              submitted={ownGroup.question}
            />
          )}

          {ownGroup?.role === "investor" && room.phase === "investing" && (
            <InvestorPanel
              investor={ownGroup}
              sellers={sellers}
              selectedSellerIds={selectedSellerIds}
              totalInvestment={totalInvestment}
              toggleSeller={toggleSeller}
              confirmDeals={confirmDeals}
              question={question}
              setQuestion={setQuestion}
              sendQuestion={sendQuestion}
            />
          )}

          {ownGroup?.role === "seller" &&
            ["lobby", "pitch"].includes(room.phase) && (
            <SellerWorkspace
              seller={ownGroup}
              room={room}
              editingIdeas={editingIdeas}
              setEditingIdeas={setEditingIdeas}
              ideaDrafts={ideaDrafts}
              setIdeaDrafts={setIdeaDrafts}
              saveIdea={saveIdea}
            />
          )}

          {isTeacher && ["pitch", "investing"].includes(room.phase) && (
            <section className="teacher-board">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">LIVE CLASS</span>
                  <h2>Seller pitch board</h2>
                </div>
                <span className="section-meta">
                  {savedPitchCount}/{sellers.length} pitches saved · timers controlled here
                </span>
              </div>
              {room.phase === "pitch" && (
                <button
                  className="button button-green phase-advance"
                  type="button"
                  disabled={savedPitchCount !== sellers.length}
                  onClick={() => action("teacher:openInvestment", null)}
                >
                  Open investment round
                </button>
              )}
              <div className="seller-grid">
                {sellers.map((seller) => (
                  <SellerCard
                    key={seller.id}
                    seller={seller}
                    canControlTimer={room.phase === "pitch"}
                    action={action}
                  />
                ))}
              </div>
              {investor?.question && (
                <div className="teacher-question">
                  <span>INVESTOR QUESTION</span>
                  <p>{investor.question}</p>
                </div>
              )}
            </section>
          )}

          {ownGroup?.role === "investor" &&
            ["pitch", "investing", "ended"].includes(room.phase) && (
            <section className="seller-board">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{sellers.length} SELLER GROUPS</span>
                  <h2>Explore the pitches</h2>
                </div>
                <span className="section-meta">One investment decision</span>
              </div>
              <div className="seller-grid">
                {sellers.map((seller) => (
                  <SellerCard
                    key={seller.id}
                    seller={seller}
                    action={action}
                    investorView
                  />
                ))}
              </div>
            </section>
          )}
          <footer className="app-footer">
            <span>PitchDay classroom game</span>
            <span>
              Room {room.code} <i /> {room.groups.length} players
            </span>
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className="welcome-screen">
      <header className="welcome-header">
        <a className="wordmark" href="#home">
          <span className="brand-icon">
            <Award size={18} />
          </span>
          <span>
            pitch<span>day</span>
          </span>
        </a>
        <span className={`server-status ${connected ? "" : "disconnected"}`}>
          <i />
          {connected
            ? "Classroom server ready"
            : "Connecting to classroom server"}
        </span>
      </header>
      <section className="welcome-layout" id="home">
        <div className="welcome-intro">
          <span className="eyebrow">THE CLASSROOM BUSINESS GAME</span>
          <h1>
            Pitch an idea.
            <br />
            <em>Win the room.</em>
          </h1>
          <p>
            One random Investor. One to seven Seller Groups. Two minutes to
            make the case, then the Investor makes a move.
          </p>
          <div className="game-steps">
            <div>
              <span>01</span>
              <p>
                <strong>Join the room</strong>
                <small>2–8 players join with a 4-digit code.</small>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Get your role</strong>
                <small>One Investor is picked at random.</small>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Pitch and invest</strong>
                <small>Timers, questions, and locked deals.</small>
              </p>
            </div>
          </div>
        </div>
        <section className="entry-card">
          <div className="entry-tabs">
            <button
              className={mode === "join" ? "active" : ""}
              type="button"
              onClick={() => {
                setMode("join");
                setError("");
              }}
            >
              Join as a player
            </button>
            <button
              className={mode === "create" ? "active" : ""}
              type="button"
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              Teacher setup
            </button>
          </div>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {mode === "join" ? (
            <form className="entry-form" onSubmit={joinRoom}>
              <div className="entry-title">
                <span className="form-icon">
                  <Users size={17} />
                </span>
                <div>
                  <h2>Join the classroom</h2>
                  <p>Ask your teacher for the 4-digit code.</p>
                </div>
              </div>
              <label htmlFor="join-code">4-digit room code</label>
              <input
                className="room-code-input"
                id="join-code"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="0000"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(event.target.value.replace(/\D/g, ""))
                }
                required
              />
              <label htmlFor="player-name">Group or student name</label>
              <input
                id="player-name"
                maxLength={32}
                placeholder="e.g. The Bright Sparks"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                required
              />
              <div className="random-note">
                <ShieldCheck size={15} />
                <span>Roles are assigned automatically. No choosing!</span>
              </div>
              <button
                className="button button-green full-button"
                type="submit"
                disabled={!connected || busy}
              >
                {busy ? "Joining..." : "Join room"}
                <ArrowRightIcon />
              </button>
            </form>
          ) : (
            <form className="entry-form" onSubmit={createRoom}>
              <div className="entry-title">
                <span className="form-icon teacher">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <h2>Create a class room</h2>
                  <p>Set up this round before players join.</p>
                </div>
              </div>
              <label htmlFor="lesson-topic">Lesson topic</label>
              <input
                id="lesson-topic"
                maxLength={64}
                placeholder="e.g. Sustainable business"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                required
              />
              <label htmlFor="starting-taps">
                Starting Investor balance ($TAPS)
              </label>
              <div className="balance-input">
                <Coins size={16} />
                <input
                  id="starting-taps"
                  type="number"
                  min="0"
                  step="1"
                  value={initialBalance}
                  onChange={(event) => setInitialBalance(event.target.value)}
                  required
                />
              </div>
              <label htmlFor="group-limit">Players in this round</label>
              <input
                id="group-limit"
                type="number"
                min="2"
                max="8"
                step="1"
                value={groupLimit}
                onChange={(event) => setGroupLimit(event.target.value)}
                required
              />
              <p className="setup-note">
                A unique code will be generated. One player is randomly chosen
                as Investor; everyone else becomes a Seller Group.
              </p>
              <button
                className="button button-green full-button"
                type="submit"
                disabled={!connected || busy}
              >
                {busy ? "Creating..." : "Generate room code"}
                <ArrowRightIcon />
              </button>
            </form>
          )}
          <div className="entry-foot">
            <LockKeyhole size={13} />
            <span>Investor choices lock when a deal is confirmed.</span>
          </div>
        </section>
      </section>
      <footer className="welcome-footer">
        <span>ONE CLASS · 2–8 PLAYERS · BIG IDEAS</span>
        <span>Think like a founder. Invest like a shark.</span>
      </footer>
    </main>
  );
}

function DealReveal({ room, sellers, investor, remainingMs }) {
  const selected = sellers.filter((seller) => seller.dealLocked);
  const totalDuration = room.revealRemainingMs || 7000;
  const progress = Math.max(0, Math.min(100, (remainingMs / totalDuration) * 100));

  return (
    <section
      className="deal-reveal"
      style={{ "--reveal-duration": `${totalDuration}ms` }}
      aria-live="polite"
    >
      <div className="reveal-topline">
        <span><i /> FINAL DEAL REVEAL</span>
        <strong>{Math.ceil(remainingMs / 1000)} SEC</strong>
      </div>
      <div className="reveal-title">
        <span className="eyebrow">THE INVESTOR HAS DECIDED</span>
        <h2>{investor?.name || "The Investor"} chose</h2>
        <p>{selected.length} {selected.length === 1 ? "Seller Group" : "Seller Groups"} backed. This round is now locked.</p>
      </div>
      <div className="reveal-cards">
        {sellers.map((seller, index) => (
          <article
            className={`reveal-seller ${seller.dealLocked ? "chosen" : "passed"}`}
            key={seller.id}
            style={{ "--reveal-index": index }}
          >
            <span className="reveal-seller-number">GROUP {seller.sellerNumber}</span>
            <strong>{seller.idea?.name || seller.name}</strong>
            <span className="reveal-founder">{seller.name}</span>
            {seller.dealLocked ? (
              <span className="reveal-deal"><Check size={15} /> {seller.dealAmount.toLocaleString()} $TAPS · {seller.idea.equity}% equity</span>
            ) : (
              <span className="reveal-passed">Not selected</span>
            )}
          </article>
        ))}
      </div>
      <div className="reveal-countdown">
        <span>GAME ENDS IN</span>
        <div className="reveal-track"><span style={{ width: `${progress}%` }} /></div>
        <strong>{Math.ceil(remainingMs / 1000)}s</strong>
      </div>
    </section>
  );
}

function GameOver({ room, sellers, investor }) {
  const selected = sellers.filter((seller) => seller.dealLocked);

  return (
    <section className="game-over" aria-live="polite">
      <div className="game-over-heading">
        <span className="game-over-stamp"><Check size={15} /> ROUND COMPLETE</span>
        <span className="eyebrow">{room.topic}</span>
        <h2>That’s a wrap.</h2>
        <p>{investor?.name || "The Investor"} finished with {investor?.credits.toLocaleString() || "0"} $TAPS.</p>
      </div>
      <div className="final-deals">
        {sellers.map((seller) => (
          <article className={`final-deal ${seller.dealLocked ? "funded" : "unfunded"}`} key={seller.id}>
            <div className="final-deal-title">
              <span>SELLER GROUP {seller.sellerNumber}</span>
              <strong>{seller.dealLocked ? "INVESTED" : "NOT SELECTED"}</strong>
            </div>
            <h3>{seller.idea?.name || seller.name}</h3>
            <p>{seller.name}</p>
            {seller.dealLocked ? (
              <div className="final-deal-terms"><strong>{seller.dealAmount.toLocaleString()} <em>$TAPS</em></strong><span>for {seller.idea.equity}% equity</span></div>
            ) : (
              <div className="final-deal-terms"><span>Requested {seller.idea?.request?.toLocaleString() || 0} $TAPS</span><span>{seller.idea?.equity || 0}% equity offered</span></div>
            )}
          </article>
        ))}
      </div>
      <footer className="game-over-footer">
        <span>{selected.length} of {sellers.length} Seller Groups received investment</span>
        <strong>Investor balance: {investor?.credits.toLocaleString() || "0"} $TAPS</strong>
      </footer>
    </section>
  );
}

function InvestorQuestion({ question, setQuestion, sendQuestion, submitted }) {
  if (submitted)
    return (
      <section className="question-locked">
        <Check size={17} />
        <span>
          <strong>Your one question is locked in.</strong>
          <small>{submitted}</small>
        </span>
      </section>
    );
  return (
    <section className="investor-question-card">
      <span className="eyebrow">ASK THE SELLERS</span>
      <h2>One question for the room</h2>
      <p>Think of a question that helps you compare the business ideas.</p>
      <form onSubmit={sendQuestion}>
        <textarea
          maxLength={180}
          rows={2}
          placeholder="Type your question..."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          required
        />
        <div>
          <small>{question.length} / 180</small>
          <button
            className="button button-light"
            type="submit"
            disabled={!question.trim()}
          >
            Send question
          </button>
        </div>
      </form>
    </section>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden="true">→</span>;
}

function Lobby({ room, isTeacher, saveSessionCode, action }) {
  return (
    <section className="lobby-section">
      <div className="lobby-code">
        <div>
          <span className="eyebrow">SHARE THIS 4-DIGIT CODE</span>
          <strong>{room.code}</strong>
          <small>{room.topic}</small>
        </div>
        <button
          className="button button-light"
          type="button"
          onClick={saveSessionCode}
        >
          <Copy size={15} /> Copy code
        </button>
      </div>
      <div className="lobby-progress">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE CLASSROOM LOBBY</span>
            <h2>Players joining</h2>
          </div>
          <span className="section-meta">
            {room.groups.length} / {room.groupLimit} players
          </span>
        </div>
        <div className="lobby-slots">
          {Array.from({ length: room.groupLimit }, (_, index) => {
            const group = room.groups[index];
            return (
              <div
                key={group?.id || index}
                className={`lobby-slot ${group ? "joined" : ""} ${group?.role || ""}`}
              >
                <span className="slot-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="slot-player">
                  {group ? (
                    <>
                      <strong>{group.name}</strong>
                      <small>
                        {group.role
                          ? group.role === "investor"
                            ? "Investor"
                            : `Seller Group ${group.sellerNumber}`
                          : "Assigning roles when room fills"}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>Waiting for player</strong>
                      <small>Join from your device</small>
                    </>
                  )}
                </span>
                {group ? (
                  <span className="joined-mark">
                    <Check size={14} />
                  </span>
                ) : (
                  <span className="waiting-dot" />
                )}
              </div>
            );
          })}
        </div>
        <div className="random-assignment">
          <span className="shuffle-icon">
            <Users size={17} />
          </span>
          <span>
            <strong>Roles are randomized when all {room.groupLimit} players join.</strong>
            <small>
              Exactly one Investor is chosen. All other players become numbered Seller Groups.
            </small>
          </span>
        </div>
        {isTeacher && (
          <button
            className="button button-green start-game"
            type="button"
            disabled={room.groups.length !== room.groupLimit || room.phase !== "lobby" || !room.groups.some((group) => group.role === "investor")}
            onClick={() => action("teacher:startRound", null)}
          >
            <Play size={15} fill="currentColor" /> Start pitches
          </button>
        )}
      </div>
    </section>
  );
}

function SellerCard({
  seller,
  action,
  investorView = false,
  canControlTimer = false,
}) {
  const timer = seller.timer || { seconds: 120, running: false };
  const progress = ((120 - timer.seconds) / 120) * 100;
  return (
    <article
      className={`seller-card ${seller.dealLocked ? "locked-card" : ""}`}
    >
      <div className="seller-card-top">
        <span className="seller-number">
          SELLER GROUP {seller.sellerNumber}
        </span>
        {seller.dealLocked && (
          <span className="locked-tag">
            <LockKeyhole size={12} /> DEAL LOCKED
          </span>
        )}
      </div>
      <h3>{seller.idea?.name || seller.name}</h3>
      <p className="seller-name">{seller.name}</p>
      <div className="seller-ask">
        <span>
          <small>REQUESTING</small>
          <strong>
            {Number(seller.idea?.request || 0).toLocaleString()} <em>$TAPS</em>
          </strong>
        </span>
        <span>
          <small>OFFERING</small>
          <strong>
            {seller.idea?.equity || 0}% <em>EQUITY</em>
          </strong>
        </span>
      </div>
      <div className={`mini-timer ${timer.seconds <= 15 ? "timer-low" : ""}`}>
        <div className="mini-timer-head">
          <span>
            <TimerReset size={14} /> {formatTime(timer.seconds)}
          </span>
          {canControlTimer && (
            <div className="timer-actions">
              <button
                type="button"
                disabled={seller.dealLocked || (!timer.running && !seller.idea?.name)}
                onClick={() =>
                  action("teacher:sellerTimer", {
                    sellerId: seller.id,
                    action: timer.running ? "pause" : "start",
                  })
                }
                aria-label={timer.running ? "Pause pitch timer" : "Start pitch timer"}
                title={timer.running ? "Pause timer" : seller.idea?.name ? "Start timer" : "Save the seller pitch first"}
              >
                {timer.running ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
              </button>
              <button
                type="button"
                disabled={seller.dealLocked}
                onClick={() =>
                  action("teacher:sellerTimer", { sellerId: seller.id, action: "reset" })
                }
                aria-label="Reset pitch timer"
                title="Reset timer"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          )}
        </div>
        <div className="mini-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      {seller.question && (
        <div className="seller-question">
          <small>INVESTOR QUESTION</small>
          <p>{seller.question}</p>
        </div>
      )}
      {investorView && seller.dealLocked && (
        <div className="deal-lock-result">
          <LockKeyhole size={14} />
          <strong>
            You invested {seller.dealAmount.toLocaleString()} $TAPS for{" "}
            {seller.idea.equity}% equity.
          </strong>
        </div>
      )}
    </article>
  );
}

function SellerWorkspace({
  seller,
  room,
  editingIdeas,
  setEditingIdeas,
  ideaDrafts,
  setIdeaDrafts,
  saveIdea,
}) {
  const draft = ideaDrafts[seller.id] || {
    name: seller.idea?.name || "",
    request: seller.idea?.request || 200,
    equity: seller.idea?.equity || 10,
  };
  const timer = seller.timer || { seconds: 120, running: false };
  return (
    <>
      <section className="seller-own-card">
        <div className="seller-own-heading">
          <div>
            <span className="eyebrow">YOUR PITCH</span>
            <h2>Seller Group {seller.sellerNumber}</h2>
          </div>
          <span className="seller-status">
            <i /> YOUR TURN
          </span>
        </div>
        {editingIdeas || !seller.idea?.name ? (
          <form className="idea-form" onSubmit={saveIdea}>
            <label htmlFor="idea-name">Your idea name</label>
            <input
              id="idea-name"
              maxLength={50}
              placeholder="Name your business or product"
              value={draft.name}
              onChange={(event) =>
                setIdeaDrafts((current) => ({
                  ...current,
                  [seller.id]: { ...draft, name: event.target.value },
                }))
              }
              required
            />
            <div className="idea-fields">
              <div>
                <label htmlFor="idea-request">Requested $TAPS</label>
                <input
                  id="idea-request"
                  type="number"
                  min="1"
                  step="1"
                  value={draft.request}
                  onChange={(event) =>
                    setIdeaDrafts((current) => ({
                      ...current,
                      [seller.id]: {
                        ...draft,
                        request: Number(event.target.value),
                      },
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="idea-equity">Equity offered (%)</label>
                <input
                  id="idea-equity"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.equity}
                  onChange={(event) =>
                    setIdeaDrafts((current) => ({
                      ...current,
                      [seller.id]: {
                        ...draft,
                        equity: Number(event.target.value),
                      },
                    }))
                  }
                  required
                />
              </div>
            </div>
            <button className="button button-green" type="submit">
              <Check size={15} /> Save pitch
            </button>
          </form>
        ) : (
          <div className="saved-idea">
            <strong>{seller.idea.name}</strong>
            <div>
              <span>
                Asking <b>{seller.idea.request} $TAPS</b>
              </span>
              <span>
                Offering <b>{seller.idea.equity}% equity</b>
              </span>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setEditingIdeas(true)}
              disabled={["revealing", "ended"].includes(room.phase)}
            >
              Edit pitch details
            </button>
          </div>
        )}
      </section>
      <section className="seller-timer-card">
        <div>
          <span className="eyebrow">YOUR TWO-MINUTE PITCH</span>
          <strong
            className={`big-timer ${timer.seconds <= 15 ? "timer-low" : ""}`}
          >
            {formatTime(timer.seconds)}
          </strong>
          <div className="large-track">
            <span
              style={{ width: `${((120 - timer.seconds) / 120) * 100}%` }}
            />
          </div>
        </div>
        <small className="timer-hint">
          Your teacher starts, pauses, and resets this timer.
        </small>
      </section>
    </>
  );
}

function InvestorPanel({
  investor,
  sellers,
  selectedSellerIds,
  totalInvestment,
  toggleSeller,
  confirmDeals,
  question,
  setQuestion,
  sendQuestion,
}) {
  const eligibleSellers = sellers.filter(
    (seller) => seller.idea?.name && !seller.dealLocked,
  );
  return (
    <>
      <section className="investor-balance-card">
        <div>
          <span className="eyebrow">YOUR INVESTMENT POWER</span>
          <strong>
            {investor.credits.toLocaleString()} <em>$TAPS</em>
          </strong>
        </div>
        <span className="wallet-mark">
          <Wallet size={20} />
        </span>
      </section>
      {investor.question ? (
        <section className="question-locked">
          <Check size={17} />
          <span>
            <strong>Your one question is locked in.</strong>
            <small>{investor.question}</small>
          </span>
        </section>
      ) : (
        <section className="investor-question-card">
          <span className="eyebrow">ASK THE SELLERS</span>
          <h2>One question for the room</h2>
          <p>Think of a question that helps you compare the business ideas.</p>
          <form onSubmit={sendQuestion}>
            <textarea
              maxLength={180}
              rows={2}
              placeholder="Type your question..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              required
            />
            <div>
              <small>{question.length} / 180</small>
              <button
                className="button button-light"
                type="submit"
                disabled={!question.trim()}
              >
                Send question
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="investment-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PICK YOUR DEALS</span>
            <h2>Invest in an idea</h2>
          </div>
          <span className="section-meta">
            {selectedSellerIds.length} selected
          </span>
        </div>
        <p className="investor-instruction">
          Choose one or more unlocked Seller Groups. Each deal uses their
          requested $TAPS.
        </p>
        {eligibleSellers.length ? (
          <>
            <div className="investment-choices">
              {eligibleSellers.map((seller) => (
                <label
                  className={`investment-choice ${selectedSellerIds.includes(seller.id) ? "selected" : ""}`}
                  key={seller.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedSellerIds.includes(seller.id)}
                    onChange={() => toggleSeller(seller.id)}
                  />
                  <span className="choice-check">
                    <Check size={13} />
                  </span>
                  <span className="choice-info">
                    <strong>
                      Group {seller.sellerNumber}: {seller.idea.name}
                    </strong>
                    <small>{seller.idea.equity}% equity offered</small>
                  </span>
                  <span className="choice-ask">
                    {seller.idea.request.toLocaleString()} <small>$TAPS</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="deal-summary">
              <span>Total investment</span>
              <strong>
                {totalInvestment.toLocaleString()} <em>$TAPS</em>
              </strong>
              <small>
                Balance after:{" "}
                {Math.max(
                  investor.credits - totalInvestment,
                  0,
                ).toLocaleString()}{" "}
                $TAPS
              </small>
            </div>
            <button
              className="button button-green confirm-deal"
              type="button"
              disabled={
                !selectedSellerIds.length || totalInvestment > investor.credits
              }
              onClick={confirmDeals}
            >
              <LockKeyhole size={15} /> Confirm and lock deal
            </button>
            {totalInvestment > investor.credits && (
              <small className="validation-note">
                Your selected deals exceed your current balance.
              </small>
            )}
          </>
        ) : (
          <div className="empty-message">
            All submitted deals are locked, or sellers are still preparing their
            ideas.
          </div>
        )}
      </section>
    </>
  );
}
