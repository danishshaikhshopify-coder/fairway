-- lead_score_events rows are immutable from the client (no UPDATE policy).
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}';

update public.lead_score_events set score = 1;
\echo UNREACHABLE
