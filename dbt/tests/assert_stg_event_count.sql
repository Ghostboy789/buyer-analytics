with raw as (
    select count(*)::bigint as raw_events
    from read_parquet(
        '{{ env_var("BUYER_RAW_GLOB", "../data/raw/events_*.parquet") }}',
        union_by_name = true
    )
),

staged as (
    select count(*)::bigint as staged_events
    from {{ ref('stg_events') }}
)

select raw.raw_events, staged.staged_events
from raw, staged
where raw.raw_events <> staged.staged_events
