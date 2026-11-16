with violations as (
    select 'fct_orders' as model_name, count(*) as failing_rows
    from {{ ref('fct_orders') }}
    where revenue_usd < 0

    union all

    select 'fct_sessions' as model_name, count(*) as failing_rows
    from {{ ref('fct_sessions') }}
    where revenue_usd < 0

    union all

    select 'fct_user_outcomes' as model_name, count(*) as failing_rows
    from {{ ref('fct_user_outcomes') }}
    where revenue_usd < 0 or pre_revenue_usd < 0

    union all

    select 'dim_users' as model_name, count(*) as failing_rows
    from {{ ref('dim_users') }}
    where revenue_usd < 0

    union all

    select 'metrics_daily' as model_name, count(*) as failing_rows
    from {{ ref('metrics_daily') }}
    where revenue_usd < 0
)

select * from violations where failing_rows > 0
