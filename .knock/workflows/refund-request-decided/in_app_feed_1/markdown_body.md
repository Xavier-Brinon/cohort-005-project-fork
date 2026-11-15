{% if data.decision == "approved" %}Your refund request for **{{ data.courseTitle }}** was **approved**. The full amount you paid is on its way back to you.{% else %}Your refund request for **{{ data.courseTitle }}** was **declined**. You still have everything you bought.{% endif %}
{% if data.note %}
> {{ data.note }}
{% endif %}
