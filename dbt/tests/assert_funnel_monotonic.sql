select *
from {{ ref('fct_funnel_daily') }}
where not (
    s_view_item >= s_add_to_cart
    and s_add_to_cart >= s_begin_checkout
    and s_begin_checkout >= s_add_shipping_info
    and s_add_shipping_info >= s_add_payment_info
    and s_add_payment_info >= s_purchase
)
