with daily as (
    select coalesce(sum(orders), 0)::bigint as daily_orders
    from {{ ref('metrics_daily') }}
),

orders as (
    select count(*)::bigint as mart_orders
    from {{ ref('fct_orders') }}
)

select daily.daily_orders, orders.mart_orders
from daily, orders
where daily.daily_orders <> orders.mart_orders
