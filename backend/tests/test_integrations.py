"""The integrations inventory.

The important test in here is the last one: this endpoint exists to describe
credentials, so the one thing it must never do is disclose one.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.integrations import describe_integrations
from app.main import app

SECRET = "sk-super-secret-value-12345"


def settings(**over) -> Settings:
    base = {
        "purview_tenant_id": None,
        "purview_client_id": None,
        "purview_client_secret": None,
        "purview_account_name": None,
        "anthropic_api_key": None,
        "chat_api_key": None,
    }
    base.update(over)
    return Settings(_env_file=None, **base)


def by_key(items):
    return {i.key: i for i in items}


def test_no_credential_reaches_the_output():
    """The whole point of the page is describing secrets; leaking one while
    doing it would be a spectacular own goal."""
    items = describe_integrations(
        settings(
            purview_tenant_id="t",
            purview_client_id="c",
            purview_client_secret=SECRET,
            anthropic_api_key=SECRET,
            purview_account_name="contoso-purview",
        ),
        env={"DATABASE_URL": f"postgres://user:{SECRET}@db.example.com/prod"},
    )
    blob = repr([vars(i) for i in items])
    assert SECRET not in blob
    # Not masked either — absent. A masked secret still discloses its length.
    assert "sk-" not in blob


def test_a_postgres_url_contributes_its_host_but_not_its_credentials():
    items = by_key(
        describe_integrations(
            settings(), env={"DATABASE_URL": "postgres://user:pw@db.example.com:5432/prod"}
        )
    )
    store = items["share-store"]
    assert store.host == "db.example.com:5432"
    assert "pw" not in store.host
    assert "user" not in store.host


def test_everything_is_listed_even_when_nothing_is_configured():
    """A page that hides what is not set up cannot be used to set things up."""
    items = describe_integrations(settings(), env={})
    assert {i.key for i in items} >= {
        "fabric",
        "onelake",
        "powerbi-scanner",
        "purview",
        "assistant",
        "share-store",
    }


def test_optional_services_report_themselves_unconfigured():
    items = by_key(describe_integrations(settings(), env={}))
    assert items["powerbi-scanner"].configured is False
    assert items["purview"].configured is False
    assert items["assistant"].configured is False
    # Fabric works on a user's own token, so it is never "unconfigured".
    assert items["fabric"].configured is True


def test_a_half_configured_principal_names_the_trap_rather_than_just_saying_no():
    """`FabricClient` refuses to build a service principal without
    PURVIEW_ACCOUNT_NAME, even for things with nothing to do with Purview. A
    page that reported a bare `false` here would send someone to check the
    wrong three variables."""
    items = by_key(
        describe_integrations(
            settings(
                purview_tenant_id="t", purview_client_id="c", purview_client_secret=SECRET
            ),
            env={},
        )
    )
    assert items["powerbi-scanner"].configured is False
    assert any("PURVIEW_ACCOUNT_NAME" in c for c in items["powerbi-scanner"].caveats)


def test_a_complete_service_principal_turns_on_everything_that_needs_it():
    items = by_key(
        describe_integrations(
            settings(
                purview_tenant_id="t",
                purview_client_id="c",
                purview_client_secret=SECRET,
                purview_account_name="acct",
            ),
            env={},
        )
    )
    assert items["powerbi-scanner"].configured is True
    assert items["graph"].configured is True
    assert items["purview"].configured is True


def test_sqlite_warns_that_share_links_do_not_survive_a_deploy():
    items = by_key(describe_integrations(settings(), env={}))
    assert any("lost on" in c for c in items["share-store"].caveats)


def test_a_configured_purview_without_writes_says_dry_run_only():
    items = by_key(
        describe_integrations(
            settings(
                purview_tenant_id="t",
                purview_client_id="c",
                purview_client_secret=SECRET,
                purview_account_name="acct",
                purview_allow_write=False,
            ),
            env={},
        )
    )
    assert items["purview"].configured is True
    assert any("dry-run" in c for c in items["purview"].caveats)


def test_the_endpoint_serves_the_inventory():
    body = TestClient(app).get("/integrations").json()
    assert isinstance(body, list) and body
    assert {"key", "name", "host", "configured", "purpose", "degrades", "needs"} <= set(body[0])


# --- identity ----------------------------------------------------------------

def test_identity_reports_the_principal_and_its_name():
    """"The app can't see my workspace" is almost always "nobody granted this
    principal access" — which is impossible to act on if its name is nowhere."""
    from app.integrations import describe_identity

    who = describe_identity(
        settings(purview_tenant_id="tid", purview_client_id="cid"),
        resolve_name=lambda app_id: "Lineage Studio SP",
    )
    assert who.mode == "service-principal"
    assert who.display_name == "Lineage Studio SP"
    assert who.client_id == "cid"


def test_identity_falls_back_to_the_client_id_when_the_directory_refuses():
    from app.integrations import describe_identity

    who = describe_identity(
        settings(purview_tenant_id="tid", purview_client_id="cid"),
        resolve_name=lambda _app_id: "",
    )
    assert who.display_name == ""
    assert "client id is exact" in who.note


def test_a_graph_failure_is_not_an_error():
    from app.integrations import describe_identity

    def boom(_app_id):
        raise RuntimeError("directory refused")

    who = describe_identity(
        settings(purview_tenant_id="tid", purview_client_id="cid"), resolve_name=boom
    )
    assert who.mode == "service-principal"
    assert who.client_id == "cid"


def test_without_a_principal_it_says_calls_are_made_as_the_user():
    from app.integrations import describe_identity

    who = describe_identity(settings())
    assert who.mode == "user"
    assert "signed-in user" in who.note
    assert who.client_id == ""


def test_the_secret_is_never_part_of_an_identity():
    from app.integrations import describe_identity

    who = describe_identity(
        settings(purview_tenant_id="t", purview_client_id="c", purview_client_secret=SECRET),
        resolve_name=lambda _a: "Name",
    )
    assert SECRET not in repr(vars(who))
