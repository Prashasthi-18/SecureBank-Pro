"""SecureBank Pro application factory."""
import secrets

from flask import Flask, g, render_template
from werkzeug.middleware.proxy_fix import ProxyFix

from . import db
from .config import Config
from .security import csrf_token, fmt_money, load_user, set_security_headers, verify_csrf


def create_app(config_object=Config, **overrides):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_object)
    app.config.update(overrides)

    if app.config.get("BEHIND_PROXY"):
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    db.init_app(app)

    @app.before_request
    def _before():
        g.csp_nonce = secrets.token_urlsafe(16)
        load_user()
        verify_csrf()

    app.after_request(set_security_headers)

    app.jinja_env.globals.update(csrf_token=csrf_token, money=fmt_money)
    app.jinja_env.globals["csp_nonce"] = lambda: g.get("csp_nonce", "")

    from .auth import bp as auth_bp
    from .bank import bp as bank_bp
    from .admin import bp as admin_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(bank_bp)
    app.register_blueprint(admin_bp)

    messages = {
        400: ("Request rejected", None),
        403: ("Access denied", "Your account doesn't have permission to open this page."),
        404: ("Page not found", "Check the address, or head back to your dashboard."),
        405: ("Method not allowed", "That action has to come from a form on this site."),
        413: ("Request too large", "Forms here accept up to 16 KB."),
        429: ("Slow down", "Too many attempts from your connection. Wait a minute and try again."),
        500: ("Something broke on our side", "Nothing was charged. Try again in a moment."),
    }

    def _handler(err):
        code = getattr(err, "code", 500) or 500
        title, default = messages.get(code, messages[500])
        detail = getattr(err, "description", None) if code == 400 else default
        return render_template("error.html", code=code, title=title, detail=detail), code

    for code in messages:
        app.register_error_handler(code, _handler)

    return app
