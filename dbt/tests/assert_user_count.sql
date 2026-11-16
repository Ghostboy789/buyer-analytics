with staged as (
    select count(distinct user_pseudo_id)::bigint as staged_users
    from {{ ref('stg_events') }}
),

users as (
    select count(*)::bigint as mart_users
    from {{ ref('dim_users') }}
)

select staged.staged_users, users.mart_users
from staged, users
where staged.staged_users <> users.mart_users
