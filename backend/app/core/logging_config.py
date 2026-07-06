import json, logging, sys
from app.core.config import settings

class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"level": record.levelname, "msg": record.getMessage(), "logger": record.name})

def setup_logging():
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter() if settings.log_json else logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logging.root.handlers = [h]
    logging.root.setLevel(logging.INFO)
