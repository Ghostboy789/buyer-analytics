with staged as (
    select count(distinct session_key)::bigint as staged_sessions
    from {{ ref('stg_events') }}
),

sessions as (
    select count(*)::bigint as mart_sessions
    from {{ ref('fct_sessions') }}
)

select staged.staged_sessions, sessions.mart_sessions
from staged, sessions
where staged.staged_sessions <> sessions.mart_sessions
