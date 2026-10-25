import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import CompetitionForm from './CompetitionForm.jsx';

export default function CompetitionNew() {
  const navigate = useNavigate();
  const toast = useToast();

  const create = async (body) => {
    // New competitions start as drafts; they can be published once questions are added.
    const res = await api.post('/admin/competitions', { ...body, isPublished: false });
    toast('Competition created. Now add questions.');
    navigate(`/admin/competitions/${res.competition.id}?tab=questions`);
  };

  return (
    <>
      <Link to="/admin/competitions" className="back-link">
        ← Competitions
      </Link>
      <div className="page-header">
        <h1>New competition</h1>
      </div>
      <div className="card">
        <CompetitionForm onSubmit={create} submitLabel="Create competition" />
      </div>
    </>
  );
}
