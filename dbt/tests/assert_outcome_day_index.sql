select *
from {{ ref('fct_user_outcomes') }}
where first_purchase_day_index is not null
    and first_purchase_day_index < entry_day_index
