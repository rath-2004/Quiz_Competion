import { Link } from 'react-router-dom';

const FEATURES = [
  ['Register once', 'Create your student account with your college and roll number, then sign up for any competition.'],
  ['Timed & fair', 'A server-controlled timer, shuffled questions and options, and automatic submission when time runs out.'],
  ['Never lose an answer', 'Every answer is saved the moment you pick it. Reconnect or refresh and continue where you left off.'],
  ['Results & rankings', 'See your score, rank and the correct answers as soon as the organisers publish results.'],
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="container landing-head">
        <Link to="/" className="brand">
          <span className="brand-mark">Q</span>
          <span>QuizArena</span>
        </Link>
        <div className="row gap-sm">
          <Link to="/login" className="btn">
            Log in
          </Link>
          <Link to="/register" className="btn btn-primary">
            Register
          </Link>
        </div>
      </header>
      <section className="container hero">
        <div className="hero-copy">
          <span className="eyebrow">Inter-college quiz championship</span>
          <h1>Compete with students from every college — online.</h1>
          <p className="lead">
            Register with your college details, join a competition and take the quiz from any device. Answers are saved
            instantly and results are ranked across all participating colleges.
          </p>
          <div className="row gap-sm wrap">
            <Link to="/register" className="btn btn-primary btn-lg">
              Register as a student
            </Link>
            <Link to="/login" className="btn btn-lg">
              I already have an account
            </Link>
          </div>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="hero-q">Q 7 of 20</div>
          <div className="hero-question">Which data structure works on the LIFO principle?</div>
          {['Queue', 'Stack', 'Linked list', 'Tree'].map((o, i) => (
            <div key={o} className={`hero-option ${i === 1 ? 'picked' : ''}`}>
              <span className="opt-key">{String.fromCharCode(65 + i)}</span>
              {o}
            </div>
          ))}
          <div className="hero-timer">⏱ 12:41 left</div>
        </div>
      </section>
      <section className="container features">
        {FEATURES.map(([title, text]) => (
          <div key={title} className="card feature">
            <h3>{title}</h3>
            <p className="muted">{text}</p>
          </div>
        ))}
      </section>
      <footer className="container landing-foot muted small">Built for inter-college quiz competitions.</footer>
    </div>
  );
}
