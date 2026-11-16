with sessions as (
    select coalesce(sum(orders), 0)::bigint as session_orders
    from {{ ref('fct_sessions') }}
),

orders as (
    select count(*)::bigint as mart_orders
    from {{ ref('fct_orders') }}
)

select sessions.session_orders, orders.mart_orders
from sessions, orders
where sessions.session_orders <> orders.mart_orders
