from pathlib import Path

from app.core.config import Settings


def test_stage_and_database_path_are_read_from_environment(monkeypatch, tmp_path: Path) -> None:
    database_path = tmp_path / "production" / "printing-ms.db"
    monkeypatch.setenv("PRINT_MS_STAGE", "production")
    monkeypatch.setenv("PRINT_MS_DATABASE_PATH", str(database_path))

    configured = Settings(_env_file=None)

    assert configured.stage == "production"
    assert configured.resolved_database_path == database_path
    assert configured.database_url == f"sqlite:///{database_path.as_posix()}"
    assert database_path.parent.is_dir()


def test_each_stage_resolves_its_own_configured_database(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("PRINT_MS_DATABASE_PATH", raising=False)
    expected_paths = {
        "development": tmp_path / "development" / "printing-ms.db",
        "test": tmp_path / "test" / "printing-ms.db",
        "production": tmp_path / "production" / "printing-ms.db",
    }
    for stage, path in expected_paths.items():
        monkeypatch.setenv(f"PRINT_MS_{stage.upper()}_DATABASE_PATH", str(path))

    for active_stage, active_path in expected_paths.items():
        monkeypatch.setenv("PRINT_MS_STAGE", active_stage)
        configured = Settings(_env_file=None)
        assert configured.resolved_database_path == active_path
        assert configured.resolved_database_paths == expected_paths
        assert configured.database_path_sources[active_stage] == f"PRINT_MS_{active_stage.upper()}_DATABASE_PATH"


def test_default_stage_database_names_are_separate(monkeypatch, tmp_path: Path) -> None:
    for name in (
        "PRINT_MS_DATABASE_PATH",
        "PRINT_MS_DEVELOPMENT_DATABASE_PATH",
        "PRINT_MS_TEST_DATABASE_PATH",
        "PRINT_MS_PRODUCTION_DATABASE_PATH",
    ):
        monkeypatch.delenv(name, raising=False)

    configured = Settings(_env_file=None, data_dir=tmp_path)
    paths = configured.resolved_database_paths

    assert paths["development"] == tmp_path / "printing-ms-dev.db"
    assert paths["test"] == tmp_path / "printing-ms-test.db"
    assert paths["production"] == tmp_path / "printing-ms.db"
    assert len(set(paths.values())) == 3


def test_printer_platform_auto_detection_and_environment_override(monkeypatch) -> None:
    monkeypatch.setattr("app.core.config.sys.platform", "win32")
    automatic = Settings(_env_file=None, printer_platform="auto")
    assert automatic.resolved_printer_platform == "windows"
    assert automatic.printer_platform_source == "automatic"

    overridden = Settings(_env_file=None, printer_platform="macos")
    assert overridden.resolved_printer_platform == "macos"
    assert overridden.printer_platform_source == "environment"
