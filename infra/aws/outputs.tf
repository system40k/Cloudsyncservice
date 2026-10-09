output "files_bucket_name" {
  description = "Private, versioned object bucket."
  value       = aws_s3_bucket.files.bucket
}

output "files_bucket_arn" {
  description = "Object bucket ARN for application integration."
  value       = aws_s3_bucket.files.arn
}

output "files_cdn_domain" {
  description = "CloudFront domain requiring signed URLs from the trusted key group."
  value       = aws_cloudfront_distribution.files.domain_name
}

output "cloudfront_key_group_id" {
  description = "Trusted key group ID used to validate signed download URLs."
  value       = aws_cloudfront_key_group.files.id
}

output "cloudfront_private_key_secret_arn" {
  description = "Empty Secrets Manager secret; securely provision the matching CloudFront private key after deployment."
  value       = aws_secretsmanager_secret.cloudfront_signing_private_key.arn
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID for OIDC integration."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_app_client_id" {
  description = "Public OAuth client ID; it is not a secret."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_hosted_ui_domain" {
  description = "Cognito hosted UI domain."
  value       = aws_cognito_user_pool_domain.users.domain
}

output "app_storage_policy_arn" {
  description = "Attach to the workload task role after the application is implemented and reviewed."
  value       = aws_iam_policy.app_storage.arn
}
