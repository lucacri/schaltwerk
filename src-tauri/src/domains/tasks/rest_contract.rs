use crate::domains::tasks::{StageRunStarted, Task};
use hyper::{Response, StatusCode, header::CONTENT_TYPE, header::HeaderValue};

pub fn json_response(status: StatusCode, body: String) -> Response<String> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

pub fn json_error(status: StatusCode, message: String) -> Response<String> {
    let body = serde_json::json!({ "error": message }).to_string();
    json_response(status, body)
}

pub fn serialize_task_response(
    status: StatusCode,
    task: &Task,
) -> Result<Response<String>, hyper::Error> {
    match serde_json::to_string(task) {
        Ok(json) => Ok(json_response(status, json)),
        Err(e) => Ok(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("serialize failed: {e}"),
        )),
    }
}

pub fn serialize_run_started_response(
    status: StatusCode,
    started: &StageRunStarted,
) -> Result<Response<String>, hyper::Error> {
    match serde_json::to_string(started) {
        Ok(json) => Ok(json_response(status, json)),
        Err(e) => Ok(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("serialize failed: {e}"),
        )),
    }
}

pub fn promote_error_status(message: &str) -> StatusCode {
    if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("already has") || message.contains("no base_branch") {
        StatusCode::CONFLICT
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub fn start_run_error_status(message: &str) -> StatusCode {
    if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("no task_branch") {
        StatusCode::CONFLICT
    } else if message.contains("at least one candidate")
        || message.contains("unsupported stage run stage")
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub fn confirm_error_status(message: &str) -> StatusCode {
    if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("no task_branch")
        || message.contains("does not match")
        || message.contains("not run")
    {
        StatusCode::CONFLICT
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

#[cfg(test)]
mod tests {
    use super::start_run_error_status;
    use hyper::StatusCode;

    #[test]
    fn unsupported_stage_start_run_errors_map_to_bad_request() {
        assert_eq!(
            start_run_error_status("unsupported stage run stage 'pushed'"),
            StatusCode::BAD_REQUEST,
        );
    }
}
