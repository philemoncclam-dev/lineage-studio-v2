"""A small built-in sample so the app demos without any Fabric connection."""

from .models import Column, IngestRequest, Node, NodeKind, NotebookSource

SAMPLE = IngestRequest(
    workspace="Analytics",
    lakehouses=[
        Node(id="lakehouse.bronze", kind=NodeKind.LAKEHOUSE, name="Bronze"),
        Node(id="lakehouse.silver", kind=NodeKind.LAKEHOUSE, name="Silver"),
        Node(
            id="table.raw_orders",
            kind=NodeKind.TABLE,
            name="raw_orders",
            parent_id="lakehouse.bronze",
            columns=[
                Column(name="order_id", data_type="long"),
                Column(name="customer", data_type="string"),
                Column(name="amount", data_type="double"),
                Column(name="ts", data_type="timestamp"),
            ],
        ),
        Node(
            id="table.orders_clean",
            kind=NodeKind.TABLE,
            name="orders_clean",
            parent_id="lakehouse.silver",
            columns=[
                Column(name="order_id", data_type="long"),
                Column(name="customer_name", data_type="string"),
                Column(name="amount", data_type="double"),
            ],
        ),
    ],
    notebooks=[
        NotebookSource(
            name="clean_orders",
            lakehouse_default="Silver",
            cells=[
                "df = spark.table('bronze.raw_orders')",
                "clean = spark.sql('''\n"
                "  SELECT order_id, upper(customer) AS customer_name, amount\n"
                "  FROM raw_orders WHERE amount > 0\n"
                "''')",
                "clean.write.mode('overwrite').saveAsTable('silver.orders_clean')",
            ],
        )
    ],
)
