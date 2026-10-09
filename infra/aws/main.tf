data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  files_bucket_name = "${var.name_prefix}-${data.aws_caller_identity.current.account_id}-${var.aws_region}-files"
}

resource "aws_kms_key" "files" {
  description             = "Encryption key for CloudSync private file objects"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "files" {
  name          = "alias/${var.name_prefix}-files"
  target_key_id = aws_kms_key.files.key_id
}

resource "aws_s3_bucket" "files" {
  bucket        = local.files_bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.files.arn
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  cors_rule {
    id              = "browser-presigned-uploads"
    allowed_methods = ["PUT", "HEAD"]
    allowed_origins = var.web_origins
    allowed_headers = ["content-type", "x-amz-checksum-sha256"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 300
  }
}

resource "aws_cloudfront_origin_access_control" "files" {
  name                              = "${var.name_prefix}-private-files-oac"
  description                       = "SigV4-only access from CloudFront to the private S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "files" {
  comment     = "Public verifier for short-lived, application-issued file download URLs"
  encoded_key = var.cloudfront_public_key_pem
  name        = "${var.name_prefix}-private-file-downloads"
}

resource "aws_cloudfront_key_group" "files" {
  comment = "Trusted signers for private user file downloads"
  items   = [aws_cloudfront_public_key.files.id]
  name    = "${var.name_prefix}-private-file-downloads"
}

resource "aws_cloudfront_cache_policy" "files" {
  name        = "${var.name_prefix}-immutable-private-files"
  comment     = "Cache versioned object keys; CloudFront validates each signed request"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "files" {
  name    = "${var.name_prefix}-private-file-security-headers"
  comment = "Restrict cross-origin downloads to configured application origins"

  cors_config {
    access_control_allow_credentials = false
    origin_override                  = true

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      items = var.web_origins
    }

    access_control_expose_headers {
      items = ["ETag", "Content-Length", "Content-Disposition"]
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                   = true
      override                  = true
    }
  }
}

resource "aws_wafv2_web_acl" "files" {
  provider    = aws.use1
  name        = "${var.name_prefix}-cloudfront"
  description = "Managed common protections and per-IP rate limiting for signed file delivery"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "RateLimitPerIp"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedCommonRules"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-cloudfront-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudwatch_log_group" "waf" {
  provider          = aws.use1
  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = 90
}

resource "aws_wafv2_web_acl_logging_configuration" "files" {
  provider                = aws.use1
  resource_arn            = aws_wafv2_web_acl.files.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # Signed CloudFront URL parameters are bearer credentials; never log them.
  redacted_fields {
    query_string {}
  }

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
}

resource "aws_cloudfront_distribution" "files" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Private, signed CloudSync object delivery"
  aliases         = var.aliases
  price_class     = var.cloudfront_price_class
  web_acl_id      = aws_wafv2_web_acl.files.arn

  origin {
    domain_name              = aws_s3_bucket.files.bucket_regional_domain_name
    origin_id                = "private-s3-files"
    origin_access_control_id = aws_cloudfront_origin_access_control.files.id
  }

  default_cache_behavior {
    target_origin_id           = "private-s3-files"
    viewer_protocol_policy    = "redirect-to-https"
    allowed_methods           = ["GET", "HEAD"]
    cached_methods            = ["GET", "HEAD"]
    compress                  = true
    cache_policy_id           = aws_cloudfront_cache_policy.files.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.files.id
    trusted_key_groups        = [aws_cloudfront_key_group.files.id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.aliases) == 0
    acm_certificate_arn             = var.acm_certificate_arn
    ssl_support_method              = length(var.aliases) == 0 ? null : "sni-only"
    minimum_protocol_version        = "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = length(var.aliases) == 0 || can(regex("^arn:[^:]+:acm:us-east-1:", var.acm_certificate_arn))
      error_message = "CloudFront custom-domain certificates must be in us-east-1."
    }
  }
}

resource "aws_s3_bucket_policy" "files" {
  bucket = aws_s3_bucket.files.id
  policy = data.aws_iam_policy_document.files_bucket.json
}

data "aws_iam_policy_document" "files_bucket" {
  statement {
    sid    = "AllowCloudFrontOriginAccessControlRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.files.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.files.arn]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_cognito_user_pool" "users" {
  name                = "${var.name_prefix}-users"
  deletion_protection = "ACTIVE"
  mfa_configuration   = "ON"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 3
  }

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  schema {
    attribute_data_type = "String"
    mutable             = true
    name                = "email"
    required            = true

    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${var.name_prefix}-web"
  user_pool_id                         = aws_cognito_user_pool.users.id
  generate_secret                      = false
  enable_token_revocation              = true
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 7

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "users" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_secretsmanager_secret" "cloudfront_signing_private_key" {
  name                    = "${var.name_prefix}/cloudfront-signing-private-key"
  description             = "Provision the CloudFront signing private key through an approved secret-handling workflow."
  recovery_window_in_days = 30
}

data "aws_iam_policy_document" "app_storage" {
  statement {
    sid       = "ListOnlyTheFileBucket"
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.files.arn]
  }

  statement {
    sid = "TransferObjectsWithoutBucketWideDelete"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.files.arn}/*"]
  }

  statement {
    sid       = "UseFileEncryptionKeyViaS3Only"
    actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.files.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.aws_region}.${data.aws_partition.current.dns_suffix}"]
    }

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:s3:arn"
      values   = ["${aws_s3_bucket.files.arn}/*"]
    }
  }

  statement {
    sid       = "ReadOnlyTheCloudFrontSigningSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.cloudfront_signing_private_key.arn]
  }
}

resource "aws_iam_policy" "app_storage" {
  name        = "${var.name_prefix}-object-transfer"
  description = "Least-privilege S3, KMS, and signing-key access for the reviewed application workload role."
  policy      = data.aws_iam_policy_document.app_storage.json
}
