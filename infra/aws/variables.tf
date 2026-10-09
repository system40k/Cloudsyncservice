variable "aws_region" {
  description = "AWS region for the Cognito and S3 resources. CloudFront ACM certificates, if used, must be in us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment tag."
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Lowercase prefix used for globally unique resource names."
  type        = string
  default     = "cloudsync-prod"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3-30 lowercase letters, digits, or hyphens and start/end with a letter or digit."
  }
}

variable "web_origins" {
  description = "Exact HTTPS origins allowed by S3 upload CORS and CloudFront download CORS. Do not use '*'."
  type        = list(string)

  validation {
    condition = length(var.web_origins) > 0 && alltrue([
      for origin in var.web_origins : can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$", origin))
    ])
    error_message = "Provide exact HTTPS origins containing only a hostname and optional port; wildcards and URL paths are not allowed."
  }
}

variable "callback_urls" {
  description = "Exact Cognito OAuth callback URLs for deployed clients."
  type        = list(string)

  validation {
    condition     = length(var.callback_urls) > 0 && alltrue([for url in var.callback_urls : can(regex("^https://", url))])
    error_message = "Provide at least one HTTPS callback URL."
  }
}

variable "logout_urls" {
  description = "Exact Cognito logout URLs for deployed clients."
  type        = list(string)

  validation {
    condition     = length(var.logout_urls) > 0 && alltrue([for url in var.logout_urls : can(regex("^https://", url))])
    error_message = "Provide at least one HTTPS logout URL."
  }
}

variable "cognito_domain_prefix" {
  description = "Globally unique Cognito hosted UI domain prefix."
  type        = string
}

variable "cloudfront_public_key_pem" {
  description = "Public half of an RSA-2048 or supported ECDSA CloudFront signing key pair. Never put the private key here."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("-----BEGIN PUBLIC KEY-----", var.cloudfront_public_key_pem))
    error_message = "Provide a PEM-encoded public key. Keep the matching private key out of Terraform and source control."
  }
}

variable "aliases" {
  description = "Optional custom CloudFront hostnames."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in us-east-1, required when aliases is non-empty."
  type        = string
  default     = null

  validation {
    condition     = length(var.aliases) == 0 || var.acm_certificate_arn != null
    error_message = "Set an ACM certificate ARN in us-east-1 when configuring CloudFront aliases."
  }
}

variable "cloudfront_price_class" {
  description = "CloudFront edge-location price class. Start with PriceClass_100; expand only when latency requirements justify the cost."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Choose PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "waf_rate_limit" {
  description = "Requests per five-minute window per source IP before AWS WAF blocks requests. Tune from observed legitimate traffic."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "waf_rate_limit must be at least 100 requests per five-minute window."
  }
}
